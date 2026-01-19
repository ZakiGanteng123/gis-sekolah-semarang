// ==========================================
// KONFIGURASI GLOBAL
// ==========================================
const BACKEND_URL = 'http://127.0.0.1:5001';
const MAPTILER_KEY = 'MEk7YV99WOIjFCHNLNze'; // Key MapTiler Anda

// ==========================================
// 1. LOGIKA HALAMAN LOGIN (login.html)
// ==========================================
if (document.querySelector('.login-card')) {
    const btnLogin = document.getElementById('btn-login-action');
    const inputUser = document.getElementById('username');
    const inputPass = document.getElementById('password');
    const errorMsg = document.getElementById('error-msg');

    // Event Listener Tombol Login
    if (btnLogin) {
        btnLogin.addEventListener('click', async () => {
            const username = inputUser.value;
            const password = inputPass.value;

            try {
                const res = await fetch(`${BACKEND_URL}/api/login`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, password })
                });

                if (res.ok) {
                    // Simpan status login
                    localStorage.setItem('isAdmin', 'true');
                    window.location.href = 'admin.html';
                } else {
                    errorMsg.style.display = 'block';
                    errorMsg.textContent = "Username atau password salah!";
                }
            } catch (error) {
                console.error(error);
                alert("Gagal menghubungi server. Pastikan app.py berjalan.");
            }
        });
    }
}

// ==========================================
// 2. LOGIKA HALAMAN ADMIN (admin.html)
// ==========================================
if (document.querySelector('.admin-container')) {
    const API_ADMIN = `${BACKEND_URL}/api/admin/schools`;

    // A. Cek Keamanan (Redirect jika belum login)
    if (localStorage.getItem('isAdmin') !== 'true') {
        alert("Anda belum login! Silakan masuk terlebih dahulu.");
        window.location.href = 'login.html';
    }

    // B. Jalankan Load Data
    loadSchools();

    // C. Event Listener Tombol Simpan
    const btnSave = document.getElementById('btn-save-school');
    if (btnSave) btnSave.addEventListener('click', saveSchool);

    // D. Event Listener Tombol Logout
    const btnLogout = document.getElementById('btn-logout');
    if (btnLogout) {
        btnLogout.addEventListener('click', (e) => {
            e.preventDefault();
            if (confirm("Apakah anda yakin anda akan keluar?")) {
                localStorage.removeItem('isAdmin');
                window.location.href = 'index.html';
            }
        });
    }

    // --- Fungsi-Fungsi Admin ---

    async function loadSchools() {
        try {
            const res = await fetch(API_ADMIN);
            const schools = await res.json();
            const tbody = document.getElementById('admin-table-body');
            tbody.innerHTML = '';

            schools.forEach(s => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${s.name}</td>
                    <td>${s.lat}</td>
                    <td>${s.lon}</td>
                    <td>
                        <button class="action-btn btn-edit" data-school='${JSON.stringify(s)}'>Edit</button>
                        <button class="action-btn btn-delete" data-id="${s.id}">Hapus</button>
                    </td>
                `;
                tbody.appendChild(tr);
            });

            // Pasang event listener untuk tombol dinamis (Edit & Hapus)
            document.querySelectorAll('.btn-edit').forEach(b => {
                b.onclick = () => editSchool(JSON.parse(b.getAttribute('data-school')));
            });
            document.querySelectorAll('.btn-delete').forEach(b => {
                b.onclick = () => deleteSchool(b.getAttribute('data-id'));
            });

        } catch (error) {
            console.error("Gagal memuat data:", error);
        }
    }

    async function saveSchool() {
        const id = document.getElementById('school-id').value;
        const name = document.getElementById('school-name').value;
        const lat = document.getElementById('school-lat').value;
        const lon = document.getElementById('school-lon').value;

        if (!name || !lat || !lon) return alert("Isi semua data!");

        const method = id ? 'PUT' : 'POST';
        try {
            await fetch(API_ADMIN, {
                method: method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id, name, lat, lon })
            });
            alert("Berhasil disimpan!");
            clearForm();
            loadSchools();
        } catch (error) {
            alert("Gagal menyimpan data.");
        }
    }
    async function deleteSchool(id) {
        if (confirm("Yakin hapus data ini?")) {
            await fetch(`${API_ADMIN}?id=${id}`, { method: 'DELETE' });
            loadSchools();
        }
    }

    function editSchool(s) {
        document.getElementById('school-id').value = s.id;
        document.getElementById('school-name').value = s.name;
        document.getElementById('school-lat').value = s.lat;
        document.getElementById('school-lon').value = s.lon;
        window.scrollTo(0, 0); // Scroll ke atas
    }

    function clearForm() {
        document.getElementById('school-id').value = '';
        document.getElementById('school-name').value = '';
        document.getElementById('school-lat').value = '';
        document.getElementById('school-lon').value = '';
    }
}

// ==========================================
// 3. LOGIKA HALAMAN PETA (index.html)
// ==========================================
if (document.getElementById('map')) {
    
    // --- Elemen UI ---
    const startInput = document.getElementById('start');
    const endInput = document.getElementById('end');
    const loadingOverlay = document.getElementById('loading-overlay');
    const searchResultsContainer = document.getElementById('school-search-results');
    const routeDetailsContainer = document.getElementById('route-details');
    const routeInfoP = document.getElementById('route-info');
    const resetRouteBtn = document.getElementById('reset-route-btn');
    const btnCariMulti = document.getElementById('btn-cari-terdekat');
    const btnClearRoutes = document.getElementById('btn-clear-routes');
    const checkSmp = document.getElementById('check-smp');
    const checkSma = document.getElementById('check-sma');

    // --- Inisialisasi Peta ---
    const map = L.map('map').setView([-6.9932, 110.4203], 13);
    const userIcon = L.icon({
        iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png',
        shadowUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-shadow.png',
        iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41]
    });

    L.tileLayer(`https://api.maptiler.com/maps/streets-v2/{z}/{x}/{y}.png?key=${MAPTILER_KEY}`, {
        attribution: '&copy; MapTiler &copy; OpenStreetMap contributors'
    }).addTo(map);

    // --- Variabel State ---
    let allSchoolsData = []; 
    let userLocationMarker = null;
    let currentRouteLayer = null;      
    let multipleRouteLayers = [];
    let routeLabels = []; // <--- TAMBAHKAN INI (Array untuk menyimpan label nama)
    let isManualLocation = false;
    let currentDestCoord = null;    

    // --- Fungsi Helper ---
    function showLoading(show) {
        if(loadingOverlay) loadingOverlay.style.display = show ? 'flex' : 'none';
    }

    function clearAllRoutes() {
        if (currentRouteLayer) map.removeLayer(currentRouteLayer);
        multipleRouteLayers.forEach(l => map.removeLayer(l));
        multipleRouteLayers = [];
        
        // --- Hapus Popup/Label ---
        if (routeLabels) {
            routeLabels.forEach(label => map.removeLayer(label));
            routeLabels = []; 
        }
        // -------------------------

        if(routeDetailsContainer) routeDetailsContainer.style.display = 'none';
    }

    // --- A. Lokasi Pengguna ---
    map.locate({ watch: true, setView: true, maxZoom: 16 });

    map.on('locationfound', (e) => {
        if (isManualLocation) return;
        updateUserMarker(e.latlng, `Anda di sini (Akurasi: ${Math.round(e.accuracy/2)}m)`);
    });

    map.on('locationerror', (e) => {
        // Jangan alert terus menerus, cukup log
        console.warn("Lokasi tidak ditemukan:", e.message);
    });

    function updateUserMarker(latlng, popupText) {
        if (userLocationMarker) {
            userLocationMarker.setLatLng(latlng);
        } else {
            userLocationMarker = L.marker(latlng, { draggable: true, icon: userIcon }).addTo(map);
            userLocationMarker.on('dragend', function(e) {
                isManualLocation = true;
                map.stopLocate();
                const pos = e.target.getLatLng();
                startInput.value = `[${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)}]`;
                
                if (currentDestCoord) findRouteToSchool(currentDestCoord.lat, currentDestCoord.lon, endInput.value);
                renderSidebarList(pos.lat, pos.lng);
            });
        }
        userLocationMarker.bindPopup(popupText).openPopup();
        renderSidebarList(latlng.lat, latlng.lng);
        
        if (!isManualLocation) startInput.value = `Lokasi Anda (${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)})`;
    }

    // --- B. Load Data Sekolah ---
    fetch(`${BACKEND_URL}/api/schools`)
        .then(res => res.json())
        .then(schools => {
            schools.forEach(school => {
                const marker = L.marker([school.lat, school.lon]).addTo(map);
                marker.bindPopup(`<b>${school.name}</b>`);
                marker.on('click', () => selectSchool(school));
                allSchoolsData.push({ ...school, marker });
            });
            
            if (userLocationMarker) {
                const pos = userLocationMarker.getLatLng();
                renderSidebarList(pos.lat, pos.lng);
            }
            if(endInput) endInput.disabled = false;
        });

    // --- C. Logika Pencarian Rute ---
    function selectSchool(school) {
        currentDestCoord = { lat: school.lat, lon: school.lon };
        if(endInput) endInput.value = school.name;
        findRouteToSchool(school.lat, school.lon, school.name);
        map.setView([school.lat, school.lon], 15);
        school.marker.openPopup();
    }

    // Rute Tunggal
    function findRouteToSchool(lat, lon, name) {
        if (!userLocationMarker) return alert("Tentukan lokasi asal dahulu!");
        const start = userLocationMarker.getLatLng();
        clearAllRoutes();
        showLoading(true);

        fetch(`${BACKEND_URL}/api/route?start_lat=${start.lat}&start_lon=${start.lng}&end_lat=${lat}&end_lon=${lon}`)
            .then(res => res.json())
            .then(data => {
                const coords = data.coordinates.map(c => [c[1], c[0]]);
                currentRouteLayer = L.polyline(coords, { color: '#0000FF', weight: 7, opacity: 1 }).addTo(map);
                map.fitBounds(currentRouteLayer.getBounds(), { padding: [50, 50] });
                if(routeInfoP) routeInfoP.textContent = `${name} | ${data.distance_km.toFixed(2)} km | ${Math.round(data.duration_min)} mnt`;
                if(routeDetailsContainer) routeDetailsContainer.style.display = 'block';
            })
            .catch(err => alert("Gagal mencari rute: " + err))
            .finally(() => showLoading(false));
    }

    // 5 Rute Terdekat
    // 5 Rute Terdekat
    // 5 Rute Terdekat
    function findNearestSchools() {
        let types = [];
        if (checkSmp && checkSmp.checked) types.push('SMP');
        if (checkSma && checkSma.checked) types.push('SMA');
        if (types.length === 0) return; 

        if (!userLocationMarker) return alert("Lokasi anda belum ditemukan!");
        const start = userLocationMarker.getLatLng();
        
        clearAllRoutes();
        showLoading(true);

        fetch(`${BACKEND_URL}/api/multi-routes?start_lat=${start.lat}&start_lon=${start.lng}&types=${types.join(',')}`)
            .then(res => res.json())
            .then(data => {
                data.forEach(route => {
                    // 1. Gambar Garis Rute
                    const poly = L.polyline(route.coordinates.map(c => [c[1], c[0]]), {
                        color: '#3388ff', weight: 5, opacity: 0.6
                    }).addTo(map);
                    
                    poly.routeData = route;
                    poly.on('click', (e) => {
                        L.DomEvent.stopPropagation(e);
                        focusRoute(poly);
                    });
                    multipleRouteLayers.push(poly);

                    // --- UPDATE: Ganti Tooltip jadi Popup ---
                    // Kita buat Popup manual agar bisa terbuka bersamaan
                    const popup = L.popup({
                        autoClose: false,      // Supaya tidak menutup popup lain
                        closeOnClick: false,   // Supaya tidak hilang saat peta diklik
                        offset: [0, -30],      // Posisi di atas marker (sesuaikan tinggi pin)
                        className: 'nearest-popup' // Opsional: untuk styling tambahan jika perlu
                    })
                    .setLatLng([route.target_lat, route.target_lon])
                    .setContent(`<b>${route.name}</b>`) // Isi teks tebal seperti biasa
                    .addTo(map);

                    routeLabels.push(popup); // Simpan ke array untuk dibersihkan nanti
                    // ---------------------------------------
                });

                if (multipleRouteLayers.length > 0) map.fitBounds(L.featureGroup(multipleRouteLayers).getBounds());
            })
            .finally(() => showLoading(false));
    }

    function focusRoute(layer) {
        multipleRouteLayers.forEach(l => l.setStyle({ color: '#3388ff', opacity: 0.3, weight: 5 }));
        layer.setStyle({ color: '#0000FF', opacity: 1, weight: 8 });
        layer.bringToFront();
        const d = layer.routeData;
        currentDestCoord = { lat: d.target_lat, lon: d.target_lon };
        endInput.value = d.name;
        routeInfoP.textContent = `${d.name} | ${d.distance_km.toFixed(2)} km | ${Math.round(d.duration_min)} mnt`;
        routeDetailsContainer.style.display = 'block';
    }

    function renderSidebarList(userLat, userLon) {
        const list = document.getElementById('school-list');
        if (!list || allSchoolsData.length === 0) return;

        list.innerHTML = ''; 

        const sortedSchools = [...allSchoolsData].sort((a, b) => {
            const distA = Math.pow(a.lat - userLat, 2) + Math.pow(a.lon - userLon, 2);
            const distB = Math.pow(b.lat - userLat, 2) + Math.pow(b.lon - userLon, 2);
            return distA - distB;
        });

        sortedSchools.slice(0, 15).forEach(school => {
            const li = document.createElement('li');
            li.textContent = school.name;
            li.className = 'school-list-item';
            li.onclick = () => selectSchool(school);
            list.appendChild(li);
        });
    }

    // --- D. Event Listener Lainnya ---
    map.on('click', (e) => {
        isManualLocation = true;
        map.stopLocate();
        updateUserMarker(e.latlng, "Lokasi Asal (Manual)");
        startInput.value = `[${e.latlng.lat.toFixed(5)}, ${e.latlng.lng.toFixed(5)}]`;
        if (currentDestCoord) findRouteToSchool(currentDestCoord.lat, currentDestCoord.lon, endInput.value);
    });

    if (endInput) {
        endInput.addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase();
            searchResultsContainer.innerHTML = '';
            if (query.length < 2) return;
            allSchoolsData.filter(s => s.name.toLowerCase().includes(query)).slice(0, 5).forEach(s => {
                const div = document.createElement('div');
                div.className = 'search-result-item';
                div.textContent = s.name;
                div.onclick = () => selectSchool(s);
                searchResultsContainer.appendChild(div);
            });
        });
    }

    if(btnCariMulti) btnCariMulti.addEventListener('click', findNearestSchools);
    if(btnClearRoutes) btnClearRoutes.addEventListener('click', clearAllRoutes);
    
    if(resetRouteBtn) {
        resetRouteBtn.addEventListener('click', () => {
            clearAllRoutes();
            endInput.value = '';
            currentDestCoord = null;
        });
    }
}