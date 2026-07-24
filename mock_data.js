// Mock Data Generator for Deriv R100
// Simulates a tick roughly every second

class MockDerivAPI {
    constructor(onTickCallback) {
        this.onTick = onTickCallback;
        this.currentPrice = 12500.00;
        this.isRunning = false;
        this.intervalId = null;
    }

    start() {
        this.isRunning = true;
        this.generateTick();
    }

    stop() {
        this.isRunning = false;
        if (this.intervalId) clearTimeout(this.intervalId);
    }

    generateTick() {
        if (!this.isRunning) return;

        // Random price movement (-2.50 to +2.50)
        const change = (Math.random() - 0.5) * 5;
        this.currentPrice += change;
        
        // Format to 2 decimal places to get the last digit clearly
        const formattedPrice = this.currentPrice.toFixed(2);
        
        // Call callback
        this.onTick({
            price: formattedPrice,
            timestamp: Date.now()
        });

        // Schedule next tick (around 1000ms, slightly randomized to simulate network)
        const nextTickDelay = 800 + Math.random() * 400;
        this.intervalId = setTimeout(() => this.generateTick(), nextTickDelay);
    }
}
