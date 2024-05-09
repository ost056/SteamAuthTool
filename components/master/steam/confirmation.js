const Account = require("./index");
const SteamTotp = require("steam-totp");
const Cheerio = require('cheerio');

const Limiters = require("../limiters");

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

Account.prototype.load_confirmations = function(auto = false){
    console.log("load cconf")
    if (!this.proxy.status) return {success: false, error: "Proxy is broken"}

    const limiter = Limiters.get(this.proxy.ip);

    return limiter.schedule({priority: auto ? 5 : 4}, ()=> new Promise(res=>{
        const time = Math.floor(Date.now()/1000);
        const key = SteamTotp.getConfirmationKey(this.two_fa.identity_secret, time, "list")

        this.community.getConfirmations(time, {key, tag: "list"}, (error, resp)=>{
            if (error) res({success: false, error: error.message})
            else {
                this.confirmations = resp;
                res({success: true, confirmations: this.confirmations})
            }
        })
    }))
}

Account.prototype.load_confirmation_info = function(id){
    if (!id) return {success: false, error: "Confirmation id is broken"}
    const confirmation = this.confirmations.find(val=> val.id == id);
    if (!confirmation) return {success: false, error: "Confirmation not found"}
    const time = Math.floor(Date.now()/1000);
    const tag = "detail"
    const key = SteamTotp.getConfirmationKey(this.two_fa.identity_secret, time, tag);
    return new Promise(res=>{
        const req_options = {
            uri: "https://steamcommunity.com/mobileconf/detailspage/" +id,
            method: "GET",
            qs: {
                p: this.device_id,
                a: this.steamID,
                k: key,
                t: time,
                m: 'react',
                tag: tag
            }
        }
        this.community.httpRequest(req_options, (error, resp, body)=>{
            if (error) res({success: false, error: error.message})
            else if (typeof body != "string") res({success: false, error: "Cannot load confirmation details"})
            else {
                const $ = Cheerio.load(body)
                const offer = $('.tradeoffer');
                if(offer.length < 1) res({success: true, data: null})
                const offer_id = offer.attr('id').split('_')[1]
                const prim = offer.find(".primary");
                const second = offer.find(".secondary");
                const data = {
                    offer_id,
                    primary: get_items_info(prim),
                    secondary: get_items_info(second)
                }
                res({success: true, data})
            }
        })
    })


    function get_items_info(element){
        const result = {
            avatar: element.find(".tradeoffer_items_avatar_ctn").find("img").attr("src"),
            items: []
        }
        const items = element.find(".trade_item");
        for (let i=0;i < items.length; i++){
            const item = Cheerio.load(items[i])("*")
            const id = item.attr("data-economy-item");
            const img = item.find("img").attr("src")
            if (!id && !img) continue;
            result.items.push({id, img})
        }
        return result
    }
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
            if (error){
                console.log("respond", error)
                res({success: false, error: error.message})
            } 
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

        const list = await this.load_confirmations(true);
        if (!list.success){
            console.log(this.account_name, "autoconf", list.error)
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