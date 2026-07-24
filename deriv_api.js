class DerivAPI {
    constructor(onTickCallback) {
        this.onTick = onTickCallback;
        this.ws = null;
        this.app_id = 1089; // Generic App ID
        this.isRunning = false;
    }

    start() {
        this.isRunning = true;
        this.connect();
    }

    connect() {
        if (!this.isRunning) return;
        
        const priceEl = document.getElementById('current-price');
        const momEl = document.getElementById('price-momentum');
        
        if (priceEl) priceEl.textContent = "Connecting...";
        if (momEl) momEl.textContent = "Connecting WS...";

        this.ws = new WebSocket(`wss://api.derivws.com/trading/v1/options/ws/public`);
        
        this.ws.onopen = () => {
            console.log("Connected to Deriv WebSocket");
            if (momEl) momEl.textContent = "Connected";
            this.ws.send(JSON.stringify({ ticks: 'R_100', subscribe: 1 }));
        };
        
        this.ws.onmessage = (msg) => {
            const data = JSON.parse(msg.data);
            if (momEl && !data.tick) momEl.textContent = "Msg: " + data.msg_type; // DEBUG
            if (data.msg_type === 'tick') {
                const tick = data.tick;
                const price = tick.quote.toFixed(tick.pip_size || 2);
                this.onTick({
                    price: price,
                    epoch: tick.epoch
                });
            } else if (data.error) {
                console.error("Deriv API Error:", data.error.message);
                if (priceEl) priceEl.textContent = "API ERR";
                if (momEl) momEl.textContent = data.error.message;
            }
        };
        
        this.ws.onclose = () => {
            console.log("WebSocket connection closed. Reconnecting in 3s...");
            if (momEl) momEl.textContent = "Disconnected, retrying...";
            setTimeout(() => this.connect(), 3000);
        };

        this.ws.onerror = (error) => {
            console.error("WebSocket Error:", error);
            if (momEl) momEl.textContent = "WS Error!";
            this.ws.close(); // Force onclose to trigger reconnect
        };
    }

    stop() {
        this.isRunning = false;
        if (this.ws) {
            this.ws.onclose = null;
            this.ws.close();
        }
    }
}
