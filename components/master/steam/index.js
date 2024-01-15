const SteamTotp = require("steam-totp");
const SteamCommunity = require("steamcommunity");
const SteamSession = require("steam-session");
const SteamStore = require("steamstore");
const request = require("request");
const Proxy = require("./proxy");
const Events = require("events")

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36"

module.exports = class Account extends Events{
    _proxy = new Proxy();
    two_fa = {
        "shared_secret": "",
		"serial_number": "",
		"revocation_code": "",
		"uri": "",
		"server_time": "",
		"token_gid": "",
		"identity_secret": "",
		"secret_1": "",
		"status": 1
    };
    steamID = null;
    account_name = "";
    _refresh_token = {
        token: "",
        exp: null
    };
    _access_token = {
        token: "",
        exp: null
    };
    cookies = [];
    _auto_confirm = false;
    number = "";
    tags = [];
    isMaf = false;

    _session = null;
    _time_offset = 0;

    _login_status = {
        wait: true,
        success: false,
        error: ""
    }

    _community = null;
    _steam_store = null;

    confirmations = [];

    constructor(obj, type = 0){
        super()
        this.proxy = obj?.proxy ?? null;

        if (type == 0){
            if (obj.hasOwnProperty("Session")) this.isMaf = true;
            for (let key in obj){
                if (key == '2fa' || this.two_fa.hasOwnProperty(key) || key == "Session") continue;
                if (obj[key]) this[key] = obj[key];
            }
            for (let key in this.two_fa){
                if (obj['2fa'] && obj['2fa'][key]) this.two_fa[key] = obj['2fa'][key]
                if (obj[key]) this.two_fa[key] = obj[key];
            }
            this.reneval_refresh_token()
        }

        if (type == 1){
            for (let key in this.two_fa){
                if (obj[key]) this.two_fa[key] = obj[key]
            }
            if (obj.account_name) this.account_name = obj.account_name;
            if (obj.number) this.number = obj.number;
        }

        if (type == 2){
            this.account_name = obj.login;
            this.proxy = obj.proxy || null;
        }
    }

    set proxy(val){
        this._proxy.stop();
        this._proxy = new Proxy(val);
    }

    get proxy(){
        return this._proxy;
    }

    set auto_confirm(val){
        if (val && !this._auto_confirm){
            this._auto_confirm = true
            this.auto_confirmation()
        }
        
        if (!val) this._auto_confirm = false
    }

    get auto_confirm(){
        return this._auto_confirm;
    }

    set refresh_token(val){
        if (!validateJwt(val)) return;
        const decode = decodeJwt(val);
        this._refresh_token.token = val;
        this._refresh_token.exp = decode.exp;
    }

    get refresh_token(){
        if (!this._refresh_token.token) return "";
        const time = Date.now()/1000;
        return this._refresh_token.exp - time > 10*60 ? this._refresh_token.token : "";
    }

    set access_token(val){
        if (!validateJwt(val)) return;
        const decode = decodeJwt(val);
        this._access_token.token = val;
        this._access_token.exp = decode.exp;
    }

    get access_token(){
        if (!this._access_token.token) return "";
        const time = Date.now()/1000
        return this._access_token.exp - time > 10*60 ? this._access_token.token : "";
    }

    _init_session(){
        const {LoginSession, EAuthTokenPlatformType} = SteamSession;
        const options = this.proxy.proxy ? {httpProxy: this.proxy.proxy} : {};

        this._session = new LoginSession(EAuthTokenPlatformType.MobileApp, options)
        this._session.loginTimeout = 30000;

        if (this.refresh_token) this._session.refreshToken = this.refresh_token;
        if (this.access_token) this._session.accessToken = this.access_token;
    }
    get community(){
        if (!this._community){
            this._community = new SteamCommunity({
                userAgent: USER_AGENT,
                request: request.defaults({proxy: this.proxy.proxy})
            });
            if (this.cookies.length) this._community.setCookies(this.cookies)
        }
        return this._community;
    }
    get steam_store(){
        if (!this._steam_store){
            this._steam_store = new SteamStore({
                userAgent: USER_AGENT,
                request: request.defaults({proxy: this.proxy.proxy})
            });
            if (this.cookies.length) this._steam_store.setCookies(this.cookies)
        }
        return this._steam_store;
    }
    async loggedIn(){
        if (!this.community) this._init_community();
        return await new Promise(res=>{
            this.community.loggedIn((error, loggedIn, familyView)=>{
                if (error) res({success: false, error})
                else res({success: true, loggedIn, familyView})
            })
        })
    }

    async login(password, accountName = this.account_name){
        const { EAuthSessionGuardType } = SteamSession;
        if (!this._session) this._init_session();
        try{
            const options = {accountName, password};
            const code = this.auth_code
            if (code) options.steamGuardCode = code
            
            const result = await this._session.startWithCredentials(options);
            this.steamID = this._session.steamID.toString();
            this.__process_session_events();
            if (result.actionRequired){
                return {success: true, status: 2, actions: result.validActions.map(val=> EAuthSessionGuardType[val.type])}
            }

            while(true){
                if (!this._login_status.wait) break;
                await new Promise(res=>{
                    setTimeout(res, 300);
                })
            }

            if (this._login_status.success) return {success: true, status: 1};
            else return {success: false, error: this._login_status.error}
        }catch(error){
            return {success: false, error: error.message}
        }
    }

    async set_guard_code(code){
        if (!this._login_status.wait){
            if (this._login_status.success) return {success: true, status: 1};
            else return {success: false, error: this._login_status.error}
        }
        try{
            await this._session.submitSteamGuardCode(code);
            while(true){
                if (!this._login_status.wait) break;
                await new Promise(res=>{
                    setTimeout(res, 300);
                })
            }

            if (this._login_status.success) return {success: true};
            else return {success: false, error: this._login_status.error}
        }catch(error){
            return {success: false, error: error.message}
        }
    }

    async get_cookies(repeat = true){
        if (!this.refresh_token) return {success: false, error: "Not Logged"};

        if (this.cookies.length){
            const item = this.cookies.find(val=> val.includes("steamLoginSecure="));
            if (item){
                const login_obj = decodeJwt(item.split("=")[1]);
                const time = Math.floor(Date.now()/1000)
                if (login_obj.exp - time > 10*60) return {success: true, cookies: this.cookies, updated: false};
            }
        }
        
        if (!this.proxy.status) return {success: false, error: "Proxy is broken"}

        if (!this._session) this._init_session();

        try{
            this.cookies = await this._session.getWebCookies()
            if (!this.access_token) this.access_token = this._session.accessToken;

            this._session = null;
            return {success: true, cookies: this.cookies, updated: true}
        }catch(error){
            this._session = null;
            if (!repeat) return {success: false, error: error.message};
            return await this.get_cookies(repeat);
        }
    }

    async refresh_access_token(repeat = true){
        if (!this.refresh_token) return {success: false, error: "Not Logged"}
        if (this.access_token) return {success: true}
        if (!this._session) this._init_session();

        try{
            await this._session.refreshAccessToken()

            this.access_token = this._session.accessToken;
            this.steamID = this._session.steamID.toString();
            this.emit("update");
        }catch(error){
            if (repeat) await this.refresh_access_token(repeat)
            else return {success: false, error: error.message}
        }

        this._session = null;
        return {success: true}
    }

    async reneval_refresh_token(){
        if (!this.refresh_token) return;

        const time = Date.now()/1000;
        if (this._refresh_token.exp - time > 60*24*60*60) return;

        if (!this._session) this._init_session();

        try{
            const updated = await this._session.renewRefreshToken();
            if (updated) this.refresh_token = this._session.refreshToken;
            this.access_token = this._session.accessToken;
            this.emit("update")
            this._session = null;
        }catch(error){
            console.log(error)
            return this.reneval_refresh_token();
        }
    }

    async update_session(){
        const {updated} = await this.get_cookies();
        if (updated) this.emit("update");
        //await this.refresh_access_token();
    }

    async qr_auth(url){
        if (!this.refresh_token || !this.two_fa.shared_secret || !url) return {success: false, error: "Can't approved"};
        if (!this.proxy.status) return {success: false, error: "Proxy is broken"}
        await this.refresh_access_token();
        const options = this.proxy.proxy ? {httpProxy: this.proxy.proxy} : {};
        const approver = new SteamSession.LoginApprover(this.access_token, this.two_fa.shared_secret, options);

        try{
            await approver.approveAuthSession({qrChallengeUrl: url, approve: true})
            return {success: true}
        }catch(error){
            return {success: false, error: error.message};
        }
    }

    __process_session_events(){
        this._session.on("error", error=>{
            this._session.removeAllListeners();
            this._session = null;

            this._login_status.wait = false;
            this._login_status.error = error.message;
            this._login_status.success = false;
        })

        this._session.on("timeout", ()=>{
            this._session.removeAllListeners();
            this._session = null;

            this._login_status.wait = false;
            this._login_status.error = 'Timeout';
            this._login_status.success = false;
        })

        this._session.on("authenticated", async ()=>{
            this._session.removeAllListeners();
            this.access_token = this._session.accessToken;
            this.refresh_token = this._session.refreshToken;
            this.account_name = this._session.accountName;

            this._session.removeAllListeners();
            await this.get_cookies(false);
            this._session = null;

            this._login_status.wait = false;
            this._login_status.success = true;
        })
    }

    object4save(){
        this.isMaf = true;
        return {
            ...this.two_fa,
            steamID: this.steamID,
            account_name: this.account_name,
            access_token: this.access_token,
            auto_confirm: this.auto_confirm,
            refresh_token: this.refresh_token,
            device_id: this.device_id,
            cookies: this.cookies,
            number: this.number,
            proxy: this.proxy.full,
            tags: this.tags,
            Session: {
                SteamID: this.steamID
            }
        }
    }
}

require("./twofactor")
require("./confirmation");

function decodeJwt(jwt) {
    if (!jwt || typeof jwt != "string") return null;
	let parts = jwt.split('.');
	if (parts.length != 3) return null;

	let standardBase64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    try{
        return JSON.parse(Buffer.from(standardBase64, 'base64').toString('utf8'));
    }catch(error){
        return null
    }
};

function validateJwt(jwt){
    const obj = decodeJwt(jwt)
    if (!obj) return false;
    const timenow = Date.now()/1000;
    return obj.exp && obj.exp > timenow + 10*60;
}