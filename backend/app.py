import psycopg2
import networkx as nx
import math
import os
from flask import Flask, jsonify, request, session
from flask_cors import CORS

# --- Konfigurasi Aplikasi ---
app = Flask(__name__)
app.secret_key = 'kunci_rahasia_gis_semarang' # Kunci rahasia untuk session login
CORS(app) # Mengizinkan Cross-Origin Resource Sharing

AVERAGE_SPEED_KMH = 30.0
# ======================

# --- Konfigurasi Database ---
DATABASE_URL = os.environ.get('DATABASE_URL', "postgresql://admin:password123@localhost/gis")

def haversine(lon1, lat1, lon2, lat2):
    """
    Hitung jarak (dalam meter) antara dua titik lat/lon
    """
    R = 6371000  # Radius bumi dalam meter
    lon1, lat1, lon2, lat2 = map(math.radians, [lon1, lat1, lon2, lat2])
    
    dlon = lon2 - lon1
    dlat = lat2 - lat1
    
    a = math.sin(dlat / 2)**2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    
    distance = R * c
    return distance
# --- Memuat Graf Peta (dilakukan sekali saat server start) ---
print("Memuat graf jalan dari database...")
G = nx.Graph()
try:
    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor()

    # Query yang sudah diperbaiki untuk menghitung panjang dalam meter
    cur.execute("""
        SELECT 
            ST_AsText(ST_Transform(way, 4326)), 
            ST_Length(ST_Transform(way, 4326)::geography)
        FROM planet_osm_line
        WHERE highway IN ('motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'service')
    """)
    
    for row in cur.fetchall():
        linestring, total_road_length_meters = row
        
        # Mengurai WKT (Well-Known Text) menjadi koordinat
        points = linestring.replace('LINESTRING(', '').replace(')', '').split(',')
        coords = [tuple(map(float, p.split())) for p in points]

        # --- LOGIKA BARU UNTUK MEMBAGI BOBOT SECARA PROPORSIONAL ---
        
        # 1. Hitung total jarak "manual" dari segmen-segmen
        segment_distances = []
        total_calculated_dist = 0
        for i in range(len(coords) - 1):
            lon1, lat1 = coords[i]
            lon2, lat2 = coords[i+1]
            dist = haversine(lon1, lat1, lon2, lat2)
            segment_distances.append(dist)
            total_calculated_dist += dist

        # 2. Tambahkan setiap segmen ke graf dengan bobot proporsional
        for i in range(len(coords) - 1):
            node1 = coords[i]
            node2 = coords[i+1]
            segment_dist = segment_distances[i]
            
            # Hitung proporsi segmen ini dari total
            if total_calculated_dist > 0:
                proportion = segment_dist / total_calculated_dist
            else:
                proportion = 0
                
            # Bobot final adalah proporsi dari panjang *resmi* (dari DB)
            # Ini lebih akurat daripada haversine kita
            final_weight = total_road_length_meters * proportion
            
            # Fallback jika total_road_length_meters = 0
            if final_weight <= 0:
                final_weight = segment_dist

            # Tambahkan HANYA SATU edge dengan bobot yang benar
            G.add_edge(node1, node2, weight=final_weight)

    # Menambahkan atribut posisi (x, y) ke setiap node
    for node in G.nodes:
        G.nodes[node]['x'] = node[0]
        G.nodes[node]['y'] = node[1]

    cur.close()
    conn.close()
    print(f"Graf berhasil dimuat: {G.number_of_nodes()} nodes dan {G.number_of_edges()} edges.")
except Exception as e:
    print(f"Gagal memuat graf: {e}")
    exit()


# --- Fungsi Helper untuk mencari node terdekat ---
def find_nearest_node(lon, lat):
    """Mencari node terdekat di graf dari sebuah koordinat."""
    nearest_node = None
    min_dist_sq = float('inf')
    
    # Pencarian sederhana menggunakan jarak kuadrat Euclidean
    for node in G.nodes:
        dist_sq = (lon - G.nodes[node]['x'])**2 + (lat - G.nodes[node]['y'])**2
        if dist_sq < min_dist_sq:
            min_dist_sq = dist_sq
            nearest_node = node
    return nearest_node

# --- API Endpoints ---
# --- ADMIN API ---

@app.route('/api/login', methods=['POST'])
def login():
    data = request.json
    username = data.get('username')
    password = data.get('password')

    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor()
    cur.execute("SELECT id, username FROM admins WHERE username = %s AND password = %s", (username, password))
    user = cur.fetchone()
    cur.close()
    conn.close()

    if user:
        session['logged_in'] = True
        return jsonify({"message": "Login berhasil", "status": "success"})
    else:
        return jsonify({"message": "Username atau password salah", "status": "error"}), 401

@app.route('/api/admin/schools', methods=['GET', 'POST', 'PUT', 'DELETE'])
def manage_schools():
    # Cek login session (opsional, aktifkan jika perlu keamanan ketat)
    #if not session.get('logged_in'):
        #return jsonify({"error": "Unauthorized"}), 401

    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor()

    try:
        # 1. READ (Ambil data)
        if request.method == 'GET':
            # Kita ambil langsung kolom lat/lon yang sudah ada di tabel
            cur.execute("SELECT id, nama_sekolah, lat, lon FROM sekolah ORDER BY id DESC")
            schools = []
            for row in cur.fetchall():
                schools.append({
                    "id": row[0],
                    "name": row[1],
                    "lat": row[2],
                    "lon": row[3]
                })
            return jsonify(schools)

        # 2. CREATE (Tambah data baru)
        elif request.method == 'POST':
            data = request.json
            # Kita update kolom lat, lon, DAN geom sekaligus agar sinkron
            query = """
                INSERT INTO sekolah (nama_sekolah, lat, lon, geom) 
                VALUES (%s, %s, %s, ST_SetSRID(ST_Point(%s, %s), 4326))
            """
            # Parameter: Nama, Lat, Lon, Lon(untuk geom), Lat(untuk geom)
            cur.execute(query, (data['name'], data['lat'], data['lon'], data['lon'], data['lat']))
            conn.commit()
            return jsonify({"message": "Data berhasil ditambahkan"})

        # 3. UPDATE (Edit data)
        elif request.method == 'PUT':
            data = request.json
            # Update nama, lat, lon, DAN geom berdasarkan ID
            query = """
                UPDATE sekolah 
                SET nama_sekolah = %s, 
                    lat = %s,
                    lon = %s,
                    geom = ST_SetSRID(ST_Point(%s, %s), 4326)
                WHERE id = %s
            """
            # Parameter urut: Nama, Lat, Lon, Lon(geom), Lat(geom), ID
            cur.execute(query, (data['name'], data['lat'], data['lon'], data['lon'], data['lat'], data['id']))
            conn.commit()
            return jsonify({"message": "Data berhasil diupdate"})

        # 4. DELETE (Hapus data)
        elif request.method == 'DELETE':
            school_id = request.args.get('id')
            cur.execute("DELETE FROM sekolah WHERE id = %s", (school_id,))
            conn.commit()
            return jsonify({"message": "Data berhasil dihapus"})

    except Exception as e:
        conn.rollback()
        print(f"Error Database: {e}")
        return jsonify({"error": str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/logout', methods=['POST'])
def logout():
    session.pop('logged_in', None) # Hapus status login dari server
    return jsonify({"message": "Berhasil keluar"})

@app.route('/api/route', methods=['GET'])
def get_route():
    # Mengambil parameter dari URL
    start_lat = float(request.args.get('start_lat'))
    start_lon = float(request.args.get('start_lon'))
    end_lat = float(request.args.get('end_lat'))
    end_lon = float(request.args.get('end_lon'))

    # 1. Cari node terdekat untuk titik awal dan akhir
    print("Mencari node terdekat...")
    start_node = find_nearest_node(start_lon, start_lat)
    end_node = find_nearest_node(end_lon, end_lat)
    
    if not start_node or not end_node:
        return jsonify({"error": "Tidak dapat menemukan node terdekat"}), 400

    print(f"Node ditemukan: {start_node} -> {end_node}")
    
    try:
        # 2. Jalankan algoritma Dijkstra
        print("Menjalankan Dijkstra...")

        # === PERUBAHAN ADA DI BLOK INI ===

        # 2a. Hitung total jarak rute (dalam meter)
        total_distance_meters = nx.dijkstra_path_length(G, start_node, end_node, weight='weight')
        
        # 2b. Dapatkan urutan node di path
        path = nx.dijkstra_path(G, start_node, end_node, weight='weight')
        
        # 3. Ubah path menjadi daftar koordinat [lon, lat]
        route_coords = [[G.nodes[node]['x'], G.nodes[node]['y']] for node in path]
        
        # 4. Hitung data tambahan (UNTUK FRONTEND)
        distance_km = total_distance_meters / 1000.0
        duration_hours = distance_km / AVERAGE_SPEED_KMH
        duration_min = duration_hours * 60
        
        # 5. Susun data JSON baru sesuai format yang diminta frontend
        response_data = {
            "coordinates": route_coords,
            "distance_km": distance_km,
            "duration_min": duration_min
        }
        
        print(f"Rute ditemukan: {distance_km:.2f} km, {duration_min:.0f} min")
        
        # 6. Kirim objek JSON yang baru
        return jsonify(response_data)
    
        # === PERUBAHAN SELESAI ===

    except nx.NetworkXNoPath:
        return jsonify({"error": "Tidak ada rute yang ditemukan"}), 404
    except Exception as e:
        print(f"Error saat mencari rute: {e}")
        return jsonify({"error": "Terjadi kesalahan internal saat mencari rute"}), 500

@app.route('/api/schools', methods=['GET'])
def get_schools():
    schools = []
    try:
        conn = psycopg2.connect(DATABASE_URL)
        cur = conn.cursor()
        # Query untuk mengambil data sekolah
        cur.execute("SELECT nama_sekolah, ST_X(geom), ST_Y(geom) FROM sekolah")
        for row in cur.fetchall():
            schools.append({
                "name": row[0],
                "lon": row[1],
                "lat": row[2]
            })
        cur.close()
        conn.close()
        return jsonify(schools)
    except Exception as e:
        print(f"Error saat mengambil data sekolah: {e}")
        return jsonify({"error": "Gagal mengambil data sekolah"}), 500
# Tambahkan endpoint ini di app.py
@app.route('/api/multi-routes', methods=['GET'])
def get_multi_routes():
    start_lat = float(request.args.get('start_lat'))
    start_lon = float(request.args.get('start_lon'))
    # Default cari keduanya jika tidak ada parameter
    types = request.args.get('types', 'SMP,SMA').split(',') 

    try:
        conn = psycopg2.connect(DATABASE_URL)
        cur = conn.cursor()
        
        # Membangun query berdasarkan pilihan checklist
        conditions = []
        if 'SMP' in types: conditions.append("nama_sekolah LIKE 'SMP%'")
        if 'SMA' in types: conditions.append("nama_sekolah LIKE 'SMA%'")
        
        if not conditions:
            return jsonify([])

        query = f"SELECT nama_sekolah, ST_X(geom), ST_Y(geom) FROM sekolah WHERE {' OR '.join(conditions)}"
        cur.execute(query)
        all_schools = cur.fetchall()
        cur.close()
        conn.close()

        # 1. Hitung jarak Euclidean kasar untuk mengambil kandidat terdekat (Efisiensi)
        # s[1] adalah lon, s[2] adalah lat
        sorted_candidates = sorted(all_schools, key=lambda s: (start_lon - s[1])**2 + (start_lat - s[2])**2)[:10]

        multi_results = []
        start_node = find_nearest_node(start_lon, start_lat)

        # 2. Hitung rute asli dengan Dijkstra untuk 5 yang benar-benar terdekat lewat jalan
        for school in sorted_candidates:
            name, lon, lat = school
            end_node = find_nearest_node(lon, lat)
            try:
                path = nx.dijkstra_path(G, start_node, end_node, weight='weight')
                dist_m = nx.dijkstra_path_length(G, start_node, end_node, weight='weight')
                coords = [[G.nodes[n]['x'], G.nodes[n]['y']] for n in path]
                
                multi_results.append({
                    "name": name,
                    "coordinates": coords,
                    "distance_km": dist_m / 1000.0,
                    "duration_min": (dist_m / 1000.0 / AVERAGE_SPEED_KMH) * 60,
                    "target_lat": lat,
                    "target_lon": lon
                })
            except nx.NetworkXNoPath:
                continue

        # Ambil 5 terdekat berdasarkan jarak jalan asli
        final_top_5 = sorted(multi_results, key=lambda x: x['distance_km'])[:5]
        return jsonify(final_top_5)

    except Exception as e:
        print(f"Error: {e}")
        return jsonify({"error": str(e)}), 500
if __name__ == '__main__':
    app.run(debug=True, port=5001)