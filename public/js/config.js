    const urlParams = new URLSearchParams(window.location.search);
    const sessionId = urlParams.get('sessionId');
    let qrcodeInstance = null;
    const socket = io();

    socket.on("connect", () => {
        console.log("[IO] Connecting...");
        console.log("[IO] JOIN-sessionId:", sessionId);
        socket.emit("join-session", sessionId);
        console.log("[IO] Connected?", socket.connected); // true
    });
    socket.on('qr', (data) => {
        console.log("[IO] Memproses data QR");
        console.log(data.qr)
        console.log('[IO] QR event received:', data.uid, 'Expected:', sessionId);
        if (data.uid !== sessionId) {
            console.log('[IO] QR uid mismatch, ignoring');
            return;
        }
        console.log('[IO] QR uid matches!');
        console.log('[IO] Rendering QR, length:', data.qr ? data.qr.length : 0);
        document.getElementById('statusValue').textContent = data.status || 'Offline';
        document.getElementById('logoutBadge').style.display = 'inline-block';
        document.getElementById('qrSection').classList.add('active');

        if (data.qr) {
            displayQRCode(data.qr);
        } else {
            console.warn('[IO] No QR data in event');
        }
    });

    socket.on('status', (data) => {
        if (data && data.session_name) {
            document.getElementById('namaValue').textContent = data.session_name;
            document.getElementById('statusValue').textContent = data.status;
            document.getElementById('statusValue').style.color = data.status === 'Online' ? '#28a745' : '#dc3545';
            if (data.status === 'STARTING') {
                document.getElementById('qrSection').classList.add('active');
            }

        }
    });
    socket.emit("config", sessionId);


    socket.on('ready', (data) => {
        console.log('[IO] Ready event received:', data.uid);
        if (data.uid === sessionId) {
            console.log('[IO] Ready uid matches! Session connected');
            document.getElementById('statusValue').textContent = 'Online';
            document.getElementById('statusValue').style.color = '#28a745';
            document.getElementById('logoutBadge').style.display = 'none';
            document.getElementById('qrSection').classList.remove('active');
            
            if (data.sessionName) {
                document.getElementById('namaValue').textContent = data.sessionName;
            }
            // Also check via API to confirm
            console.log('[IO] Confirming status via API...');
            checkSessionStatus();
        }
    });

    socket.on('disconnected', (data) => {
        console.log('[IO] Disconnected event received:', data.uid);
        if (data.uid === sessionId) {
            console.log('[IO] Disconnected uid matches! Showing offline status');
            document.getElementById('statusValue').textContent = 'Offline';
            document.getElementById('statusValue').style.color = '#dc3545';
            document.getElementById('logoutBadge').style.display = 'inline-block';
            document.getElementById('qrSection').classList.add('active');
        }
    });

    // sessionId is uid; the real display name will be loaded from API

    document.getElementById('sendMessageBtn').addEventListener('click', sendMessage);
    
    // Check session status on load (fallback)

    // Generate QR code
    function displayQRCode(qrData) {
        console.log('[displayQRCode] Called with data length:', qrData.length);
        const container = document.getElementById('qrCodeContainer');
        
        if (!container) {
            console.error('[displayQRCode] Container #qrCodeContainer not found!');
            return;
        }
        console.log('[displayQRCode] Container found, clearing...');
        container.innerHTML = '';
        
        if (typeof QRCode === 'undefined') {
            console.error('[displayQRCode] QRCode library not loaded!');
            container.innerHTML = '<p style="color: #dc3545;">QRCode library not loaded</p>';
            return;
        }
        console.log('[displayQRCode] QRCode library available');
        
        try {
            console.log('[displayQRCode] Creating QRCode instance...');
            qrcodeInstance = new QRCode(container, {
                text: qrData,
                width: 200,
                height: 200,
                correctLevel: QRCode.CorrectLevel.H,
                colorDark: '#000000',
                colorLight: '#ffffff'
            });
            console.log('[displayQRCode] QRCode instance created successfully');
            console.log('[displayQRCode] Container children:', container.children.length);
        } catch (error) {
            console.error('[displayQRCode] Error generating QR code:', error);
            container.innerHTML = '<p style="color: #dc3545;">Failed to generate QR code: ' + error.message + '</p>';
        }
    }

    // Check status on page load
    function sendMessage() {
        const phone = document.getElementById('phone').value;
        const message = document.getElementById('messageInput').value;
        const successMsg = document.getElementById('successMessage');
        const errorMsg = document.getElementById('errorMessage');

        // Reset messages
        successMsg.style.display = 'none';
        errorMsg.style.display = 'none';

        if (!phone || !message) {
            errorMsg.textContent = '⚠ Please fill in all fields';
            errorMsg.style.display = 'block';
            return;
        }

        const sendBtn = event.target;
        sendBtn.disabled = true;
        sendBtn.textContent = 'Sending...';

        fetch('/api/wa/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId, to: phone, message })
        })
        .then(res => {
            if (!res.ok) {
                throw new Error(`HTTP error! status: ${res.status}`);
            }
            return res.json();
        })
        .then(data => {
            if (data.ok) {
                successMsg.style.display = 'block';
                document.getElementById('messageInput').value = '';
                document.getElementById('phone').value = '';
                setTimeout(() => {
                    successMsg.style.display = 'none';
                }, 3000);
            } else {
                errorMsg.textContent = '✗ ' + (data.error || 'Failed to send message');
                errorMsg.style.display = 'block';
            }
        })
        .catch(err => {
            console.error('Error sending message:', err);
            errorMsg.textContent = '✗ Error: ' + err.message;
            errorMsg.style.display = 'block';
        })
        .finally(() => {
            sendBtn.disabled = false;
            sendBtn.textContent = 'Send Message';
        });
    }
