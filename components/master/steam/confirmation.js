const Account = require("./index");
const SteamTotp = require("steam-totp");

Object.defineProperty(Account.prototype, "auth_code", {
    get(){
        if (!this.two_fa.shared_secret) return null;
        else return SteamTotp.getAuthCode(this.two_fa.shared_secret, this._time_offset)
    }
})

Object.defineProperty(Account.prototype, "device_id", {
    get(){
        if (!this.steamID) return null;
        else return SteamTotp.getDeviceID(this.steamID)
    }
})

Account.prototype.load_confirmations = function(){
    if (!this.proxy.status) return {success: false, error: "Proxy is broken"}
    return new Promise(res=>{
        const time = Math.floor(Date.now()/1000);
        const key = SteamTotp.getConfirmationKey(this.two_fa.identity_secret, time, "list")

        this.community.getConfirmations(time, {key, tag: "list"}, (error, resp)=>{
            if (error) res({success: false, error: error.message})
            else {
                this.confirmations = resp;
                res({success: true, confirmations: this.confirmations})
            }
        })
    })
}

Account.prototype.respond_confirmations = function(ids, action = true){
    const id = []
    const keys = [];
    if (typeof ids == "string"){
        const confirmation = this.confirmations.find(val=> val.id == ids);
        if (!confirmation) return {success: false, error: "Confirmation not found"}
        id.push(ids);
        keys.push(confirmation.key);
    }else{
        ids.forEach(item=>{
            const confirmation = this.confirmations.find(val=> val.id == item);
            if (!confirmation) return
            id.push(confirmation.id);
            keys.push(confirmation.key);
        })
    }

    const time = Math.floor(Date.now()/1000);
    const tag = action ? "accept" : "reject";
    const key = SteamTotp.getConfirmationKey(this.two_fa.identity_secret, time, tag);
    if (!id.length) return {success: true}
    if (!this.proxy.status) return {success: false, error: "Proxy is broken"}
    return new Promise(res=>{
        this.community.respondToConfirmation(id, keys, time, {key, tag}, action, error=>{
            if (error) res({success: false, error: error.message})
            else{
                this.confirmations = this.confirmations.filter(val=> !ids.includes(val.id));
                res({success: true})
            } 
        })
    })
}

Account.prototype.auto_confirmation = async function(timeout = 30000){
    if (!this.auto_confirm) return;
    if (this.proxy.status){
        await this.update_session();

        const list = await this.load_confirmations();
        if (!list.success){
            setTimeout(()=>{
                this.auto_confirmation();
            }, 10000)
            return;
        }

        const ids = list.confirmations.map(val=> val.id);
        if (ids.length) await this.respond_confirmations(ids);

    }
    setTimeout(()=>{
        this.auto_confirmation();
    }, timeout);
}