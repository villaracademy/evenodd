const App = {
    ticks: [],
    tradeHistory: [],
    maxTicks: 100,
    currentSecond: 0,
    nextSignalTarget: 0,
    
    // Trade State
    activeTrade: null, // { direction: 'EVEN'|'ODD', step: 0|1|2, initialDirection: 'EVEN'|'ODD', startTime: 'string' }
    stats: {
        win: 0,
        g1: 0,
        g2: 0,
        loss: 0
    },
    
    // UI Elements
    ui: {
        price: document.getElementById('current-price'),
        momentum: document.getElementById('price-momentum'),
        recentTicks: document.getElementById('recent-ticks-container'),
        histContainer: document.getElementById('histogram-container'),
        bar20E: document.getElementById('bar-20-even'),
        bar20O: document.getElementById('bar-20-odd'),
        bar100E: document.getElementById('bar-100-even'),
        bar100O: document.getElementById('bar-100-odd'),
        countdownText: document.getElementById('countdown-seconds'),
        countdownCircle: document.getElementById('countdown-circle'),
        signalCard: document.getElementById('signal-card'),
        signalDir: document.getElementById('signal-direction'),
        signalConf: document.getElementById('signal-confidence'),
        signalFactors: document.getElementById('signal-factors-list'),
        statWin: document.getElementById('stat-win'),
        statG1: document.getElementById('stat-g1'),
        statG2: document.getElementById('stat-g2'),
        statLoss: document.getElementById('stat-loss'),
        resetBtn: document.getElementById('reset-stats-btn'),
        historyTbody: document.getElementById('history-tbody')
    },

    // Audio context for beep
    audioCtx: null,

    init() {
        this.loadPersistentData();
        this.setupHistogram();
        this.startClock();
        
        this.ui.resetBtn.addEventListener('click', () => this.resetStats());

        // Start Data Feed
        const api = new DerivAPI((tick) => this.handleTick(tick));
        api.start();
    },

    loadPersistentData() {
        try {
            const savedStats = localStorage.getItem('even_odd_bot_stats');
            if (savedStats) {
                const parsed = JSON.parse(savedStats);
                if (parsed) this.stats = parsed;
            }
            const savedHistory = localStorage.getItem('even_odd_bot_history');
            if (savedHistory) {
                const parsedH = JSON.parse(savedHistory);
                if (Array.isArray(parsedH)) this.tradeHistory = parsedH;
            }
        } catch (e) {
            console.warn("LocalStorage access failed:", e);
        }
        
        // Failsafe
        if (!this.stats || typeof this.stats.win === 'undefined') {
            this.stats = { win: 0, g1: 0, g2: 0, loss: 0 };
        }
        if (!Array.isArray(this.tradeHistory)) {
            this.tradeHistory = [];
        }

        this.updateStatsUI();
        this.renderHistory();
    },

    savePersistentData() {
        try {
            localStorage.setItem('even_odd_bot_stats', JSON.stringify(this.stats));
            localStorage.setItem('even_odd_bot_history', JSON.stringify(this.tradeHistory));
        } catch (e) {
            console.warn("LocalStorage save failed:", e);
        }
    },

    resetStats() {
        this.stats = { win: 0, g1: 0, g2: 0, loss: 0 };
        this.tradeHistory = [];
        this.savePersistentData();
        this.updateStatsUI();
        this.renderHistory();
    },

    setupHistogram() {
        for (let i = 0; i < 10; i++) {
            const col = document.createElement('div');
            col.className = 'hist-col';
            col.innerHTML = `
                <div class="hist-bar-wrapper">
                    <div class="hist-bar" id="hist-bar-${i}" style="height: 0%"></div>
                </div>
                <span class="hist-label">${i}</span>
            `;
            this.ui.histContainer.appendChild(col);
        }
    },

    playBeep() {
        try {
            if (!this.audioCtx) {
                this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            }
            // If it's suspended, try to resume it
            if (this.audioCtx.state === 'suspended') {
                this.audioCtx.resume();
            }
            const oscillator = this.audioCtx.createOscillator();
        const gainNode = this.audioCtx.createGain();
        oscillator.connect(gainNode);
        gainNode.connect(this.audioCtx.destination);
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(880, this.audioCtx.currentTime); // A5
        gainNode.gain.setValueAtTime(0.1, this.audioCtx.currentTime);
        oscillator.start();
            gainNode.gain.exponentialRampToValueAtTime(0.00001, this.audioCtx.currentTime + 0.5);
            oscillator.stop(this.audioCtx.currentTime + 0.5);
        } catch (e) {
            console.warn('Audio play failed', e);
        }
    },

    timeOffset: undefined,
    lastRecordedSecond: -1,

    handleTick(tick) {
        if (this.timeOffset === undefined && tick.epoch) {
            this.timeOffset = Math.floor(Date.now() / 1000) - tick.epoch;
        }

        const tickDate = new Date(tick.epoch * 1000);
        const sec = tickDate.getSeconds();
        
        // Update countdown directly on tick
        this.currentSecond = sec;
        this.updateCountdown();

        // Only record the tick if it's exactly the 0, 20, or 40 second mark
        // and prevent duplicates within the same second
        if ((sec === 0 || sec === 20 || sec === 40) && this.lastRecordedSecond !== sec) {
            this.lastRecordedSecond = sec;

            // Extract last digit
            const priceStr = tick.price.toString();
            const lastDigitStr = priceStr.slice(-1);
            const digit = parseInt(lastDigitStr, 10);
            const isEven = digit % 2 === 0;

            const tickData = {
                price: parseFloat(tick.price),
                digit: digit,
                isEven: isEven
            };

            // 1. Resolve Active Trade using THIS tick as the result
            if (this.activeTrade) {
                this.resolveTrade(tickData);
            }

            // 2. Save tick to history
            this.ticks.push(tickData);
            if (this.ticks.length > this.maxTicks) {
                this.ticks.shift();
            }

            this.updateUI(tickData);

            // 3. Generate New Signal or fresh Martingale Signal
            if (this.ticks.length >= 20) {
                if (!this.activeTrade) {
                    this.generateSignal(0); // Fresh signal
                } else {
                    this.generateSignal(this.activeTrade.step); // Fresh signal for G1/G2
                }
                this.playBeep();
            }
        } else {
            // Still update the current price on screen so it looks live
            this.ui.price.textContent = parseFloat(tick.price).toFixed(2);
        }
    },

    resolveTrade(tickData) {
        const isWin = (this.activeTrade.direction === 'EVEN' && tickData.isEven) || 
                      (this.activeTrade.direction === 'ODD' && !tickData.isEven);

        let finalResult = null;

        if (isWin) {
            // Register Win
            if (this.activeTrade.step === 0) { this.stats.win++; finalResult = 'WIN (Direto)'; }
            else if (this.activeTrade.step === 1) { this.stats.g1++; finalResult = 'WIN (G1)'; }
            else if (this.activeTrade.step === 2) { this.stats.g2++; finalResult = 'WIN (G2)'; }
            
            this.addHistoryRecord(finalResult, true);
            this.activeTrade = null; // Trade complete
            this.updateStatsUI();
        } else {
            // Loss, check Martingale steps
            if (this.activeTrade.step === 2) {
                // Total loss after G2
                this.stats.loss++;
                finalResult = 'LOSS TOTAL';
                this.addHistoryRecord(finalResult, false);
                this.activeTrade = null; // Reset for next fresh signal
                this.updateStatsUI();
            } else {
                // Move to next Martingale step, but leave direction intact for now.
                // The block below will call generateSignal with this new step.
                this.activeTrade.step++;
            }
        }
    },

    updateStatsUI() {
        this.ui.statWin.textContent = this.stats.win;
        this.ui.statG1.textContent = this.stats.g1;
        this.ui.statG2.textContent = this.stats.g2;
        this.ui.statLoss.textContent = this.stats.loss;
        this.savePersistentData();
    },

    addHistoryRecord(resultText, isWin) {
        const record = {
            time: this.activeTrade.startTime,
            initialSignal: this.activeTrade.initialDirection,
            stepText: resultText,
            isWin: isWin,
            confidence: this.activeTrade.confidence || '-'
        };
        
        // Add to beginning of array
        this.tradeHistory.unshift(record);
        // Keep max 50 records in memory
        if (this.tradeHistory.length > 50) this.tradeHistory.pop();
        
        this.savePersistentData();
        this.renderHistory();
    },

    renderHistory() {
        this.ui.historyTbody.innerHTML = '';
        this.tradeHistory.forEach(record => {
            const tr = document.createElement('tr');
            
            const badgeClass = record.isWin ? 'badge-win' : 'badge-loss';
            const badgeText = record.isWin ? 'WIN' : 'LOSS';

            tr.innerHTML = `
                <td>${record.time}</td>
                <td><strong>${record.initialSignal}</strong></td>
                <td>${record.stepText}</td>
                <td><span class="badge ${badgeClass}">${badgeText}</span></td>
                <td><strong>${record.confidence || '-'}</strong></td>
            `;
            this.ui.historyTbody.appendChild(tr);
        });
    },

    updateUI(lastTick) {
        // Update Price
        this.ui.price.textContent = lastTick.price.toFixed(2);
        
        // Update Momentum (basic diff)
        if (this.ticks.length > 1) {
            const prev = this.ticks[this.ticks.length - 2].price;
            if (lastTick.price > prev) {
                this.ui.momentum.textContent = 'Bullish ↑';
                this.ui.momentum.style.color = 'var(--accent)';
            } else if (lastTick.price < prev) {
                this.ui.momentum.textContent = 'Bearish ↓';
                this.ui.momentum.style.color = 'var(--odd-color)';
            }
        }

        // Update Recent Ticks (Last 20)
        this.ui.recentTicks.innerHTML = '';
        const recent20 = this.ticks.slice(-20);
        recent20.forEach(t => {
            const box = document.createElement('div');
            box.className = `tick-box ${t.isEven ? 'tick-even' : 'tick-odd'}`;
            box.textContent = t.digit;
            this.ui.recentTicks.appendChild(box);
        });

        // Update Bars
        this.updateBars(recent20, this.ui.bar20E, this.ui.bar20O);
        this.updateBars(this.ticks, this.ui.bar100E, this.ui.bar100O);

        // Update Histogram (Last 50)
        const recent50 = this.ticks.slice(-50);
        const counts = Array(10).fill(0);
        recent50.forEach(t => counts[t.digit]++);
        const maxCount = Math.max(...counts, 1); // Avoid div by 0
        
        for (let i = 0; i < 10; i++) {
            const bar = document.getElementById(`hist-bar-${i}`);
            const heightPct = (counts[i] / maxCount) * 100;
            if(bar) bar.style.height = `${heightPct}%`;
        }
    },

    updateBars(tickArray, elE, elO) {
        if (tickArray.length === 0) return;
        const evens = tickArray.filter(t => t.isEven).length;
        const total = tickArray.length;
        const evenPct = Math.round((evens / total) * 100);
        const oddPct = 100 - evenPct;

        elE.style.width = `${evenPct}%`;
        elE.textContent = `E: ${evenPct}%`;
        elO.style.width = `${oddPct}%`;
        elO.textContent = `O: ${oddPct}%`;
    },

    startClock() {
        setInterval(() => {
            if (this.timeOffset !== undefined) {
                const derivEpoch = Math.floor(Date.now() / 1000) - this.timeOffset;
                this.currentSecond = new Date(derivEpoch * 1000).getSeconds();
            } else {
                this.currentSecond = new Date().getSeconds();
            }
            this.updateCountdown();
        }, 1000); // Check every second
    },

    updateCountdown() {
        let diffTo20 = 20 - this.currentSecond;
        let diffTo40 = 40 - this.currentSecond;
        let diffTo00 = 60 - this.currentSecond;

        let secondsLeft;
        if (this.currentSecond < 20) {
            secondsLeft = diffTo20;
            this.nextSignalTarget = 20;
        } else if (this.currentSecond < 40) {
            secondsLeft = diffTo40;
            this.nextSignalTarget = 40;
        } else {
            secondsLeft = diffTo00; // Target next minute :00
            this.nextSignalTarget = 0;
        }

        this.ui.countdownText.textContent = secondsLeft;
        
        // Update circle (max 20 seconds cycle)
        const pct = (secondsLeft / 20) * 100;
        this.ui.countdownCircle.style.strokeDasharray = `${pct}, 100`;
    },

    generateSignal(step = 0) {
        let evenScore = 0;
        let oddScore = 0;
        const factors = [];

        // Layer 1: Frequency (40%) - Reversal strategy
        const recent20 = this.ticks.slice(-20);
        const even20 = recent20.filter(t => t.isEven).length / 20;
        if (even20 > 0.6) {
            oddScore += 40;
            factors.push(`Par muito frequente (${Math.round(even20*100)}%) -> Reversão para Ímpar`);
        } else if (even20 < 0.4) {
            evenScore += 40;
            factors.push(`Ímpar muito frequente (${Math.round((1-even20)*100)}%) -> Reversão para Par`);
        } else {
            factors.push('Frequência equilibrada (Neutro)');
            evenScore += 20; oddScore += 20;
        }

        // Layer 2: Sequence (25%)
        let consecutiveEven = 0;
        let consecutiveOdd = 0;
        for (let i = recent20.length - 1; i >= 0; i--) {
            if (recent20[i].isEven) {
                if (consecutiveOdd > 0) break;
                consecutiveEven++;
            } else {
                if (consecutiveEven > 0) break;
                consecutiveOdd++;
            }
        }
        
        if (consecutiveOdd >= 3) {
            evenScore += 25;
            factors.push(`${consecutiveOdd} Ímpares seguidos -> Bônus para Par`);
        } else if (consecutiveEven >= 3) {
            oddScore += 25;
            factors.push(`${consecutiveEven} Pares seguidos -> Bônus para Ímpar`);
        } else {
            factors.push('Sem sequências longas (Neutro)');
            evenScore += 12.5; oddScore += 12.5;
        }

        // Layer 3: Dominant Digits (20%) - Last 50 ticks
        const recent50 = this.ticks.slice(-50);
        let evenDigs = 0, oddDigs = 0;
        recent50.forEach(t => { if(t.isEven) evenDigs++; else oddDigs++; });
        if (evenDigs > oddDigs + 5) {
            oddScore += 20; // Reversal
            factors.push('Dígitos pares dominando -> Sinal Ímpar');
        } else if (oddDigs > evenDigs + 5) {
            evenScore += 20; // Reversal
            factors.push('Dígitos ímpares dominando -> Sinal Par');
        } else {
            evenScore += 10; oddScore += 10;
        }

        // Layer 4: Momentum (15%)
        let priceUp = 0;
        for (let i = 1; i < recent20.length; i++) {
            if (recent20[i].price > recent20[i-1].price) priceUp++;
        }
        if (priceUp > 12) {
            evenScore += 15; // Just an arbitrary logic for the mock
            factors.push('Tendência de alta leve -> Viés Par');
        } else if (priceUp < 8) {
            oddScore += 15;
            factors.push('Tendência de baixa leve -> Viés Ímpar');
        } else {
            evenScore += 7.5; oddScore += 7.5;
        }

        // Finalize
        const isEvenSignal = evenScore >= oddScore;
        const confidence = Math.max(evenScore, oddScore);
        const direction = isEvenSignal ? 'EVEN' : 'ODD';
        
        if (step === 0) {
            // First time signal, set initial properties
            const now = new Date();
            const timeStr = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0') + ':' + now.getSeconds().toString().padStart(2, '0');
            this.activeTrade = { direction: direction, step: step, initialDirection: direction, startTime: timeStr, confidence: Math.round(confidence) + '%' };
        } else {
            // Update direction for Martingale, preserve initial data
            this.activeTrade.direction = direction;
            this.activeTrade.step = step;
        }

        this.displaySignal(direction, confidence, factors);
    },

    displaySignal(direction, confidence, factors) {
        this.ui.signalDir.textContent = direction;
        let stepText = '';
        if (this.activeTrade && this.activeTrade.step > 0) {
            stepText = ` (G${this.activeTrade.step})`;
            this.ui.signalDir.textContent = direction + stepText;
        }

        this.ui.signalConf.textContent = `${Math.round(confidence)}%`;
        
        this.ui.signalCard.className = 'signal-card glass show';
        if (direction === 'EVEN') {
            this.ui.signalCard.classList.add('even-signal');
            this.ui.signalCard.classList.remove('odd-signal');
        } else {
            this.ui.signalCard.classList.add('odd-signal');
            this.ui.signalCard.classList.remove('even-signal');
        }

        this.ui.signalFactors.innerHTML = '';
        factors.forEach(f => {
            const li = document.createElement('li');
            li.textContent = f;
            this.ui.signalFactors.appendChild(li);
        });
    }
};

// Start the app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    App.init();
});
