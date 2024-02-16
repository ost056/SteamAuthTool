const Bottleneck = require("bottleneck/light");

class Limiter{
    _limiters = new Map();
    _config = {
        minTime: 1000,
        maxConcurrent: 1,
        reservoir: 6,
        reservoirRefreshInterval: 60000,
        reservoirRefreshAmount: 6
    }

    constructor(config = {}){
        this._config = {
            ...this._config,
            ...config
        }
        this._limiters.set("default", new Bottleneck(this._config))
    }

    set(ip = null){
        if (!ip || this._limiters.has(ip)) return;
        this._limiters.set(ip, new Bottleneck(this._config))
    }

    get(ip = null){
        if (!ip) return this._limiters.get("default");
        if (!this._limiters.has(ip)) this.set(ip)

        return this._limiters.get(ip);
    }
}

module.exports = new Limiter();