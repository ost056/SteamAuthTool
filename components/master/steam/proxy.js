const axios = require("axios");
const {HttpProxyAgent, HttpsProxyAgent} = require("hpagent");

class Proxy{
    status = true;
    _full = null

    _check_interval = null;
    constructor(proxy = ""){
        this.full = proxy;
        if (this.full){
            this.check_status();
            this._check_interval = setInterval(()=>{
                this.check_status();
            }, 60000)
        } 
    }

    set full(val){
        if (!val) return this._full = null;
        try{
            let proxy = val.includes("://") ? new URL(val) : new URL(`http://${val}`);
            if (proxy.protocol !== "http:" && proxy.protocol !== "https:") return;
            this._full = proxy;
        }catch(error){
            this._full = null
        }
    }
    get full(){
        return this._full
    }
    get ip(){
        if (!this.full) return null;
        return this.full.hostname;
    }
    get proxy(){
        if (!this.full) return "";
        return this.full.href
    }
    get http_agent(){
        if (!this.full) return null;
        return new HttpProxyAgent({proxy: this.proxy});
    }
    get https_agent(){
        if (!this.full) return null;
        return new HttpsProxyAgent({proxy: this.proxy});
    }

    get valid(){
        return !!this._full;
    }

    async check_status(){
        if (!this.full) return;
        this.status = await check_proxy(this.proxy);
    }

    toString(){
        return this.proxy;
    }

    stop(){
        if (this._check_interval) clearInterval(this._check_interval);
    }

    static async check_status(proxy){
        return await check_proxy(proxy);
    }
}

async function check_proxy(_proxy){
    if (!_proxy) return false;
    let proxy = null;
    try{
        proxy = _proxy.includes("://") ? new URL(_proxy) : new URL(`http://${_proxy}`);
    }catch(error){
        return false
    }
    const agent = new HttpsProxyAgent({proxy: proxy.href, timeout: 5000});
    try{
        await axios({
            url: "https://ya.ru/",
            httpsAgent: agent
        })
        return true;
    }catch(error){
        if (error.message == "Proxy timeout" || error.message == "Bad response: 407" || error.message.includes("getaddrinfo ENOTFOUND")) return false;
        else{
            console.log(error.message)
            return await check_proxy(proxy)
        }
    }
}

module.exports = Proxy;