const SteamTotp = require("steam-totp");
const SteamCommunity = require("steamcommunity");
const SteamSession = require("steam-session");
const SteamStore = require("steamstore");
const request = require("request");
const Proxy = require("./proxy");
const Events = require("events");
const Protobuf = require("./proto");

const EResult = SteamSession.EResult;

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

    _weak_token = ""

    cookies = [];
    _auto_confirm = false;
    number = "";
    tags = [];
    _nickname = "";
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

    __reneval_refresh_timeout = null;

    filename = "";

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

    set device_id(val){
        return
    }

    set proxy(val){
        if (val == this._proxy.full) return;

        this._proxy.stop();
        this._proxy = new Proxy(val);

        this._clear_session();

        const proxy = this._proxy.proxy ? this._proxy.proxy : null;
        if (this._community){
            this._community.request = this._community.request.defaults({
                proxy
            })
        }
        if (this._steam_store){
            this._steam_store.request = this._steam_store.request.defaults({
                proxy
            })
        }
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
        if (!val){
            this._refresh_token.token = "";
            this._refresh_token.exp = null;
            return;
        }

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
        if (!val){
            this._access_token.token = "";
            this._access_token.exp = null;
            return;
        }

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

    get nickname(){
        return this._nickname || this.account_name
    }

    set nickname(val){
        this._nickname = val;
    }

    _init_session(){
        const {LoginSession, EAuthTokenPlatformType} = SteamSession;
        const options = this.proxy.proxy ? {httpProxy: this.proxy.proxy} : {};

        this._session = new LoginSession(EAuthTokenPlatformType.MobileApp, options)
        this._session.loginTimeout = 15 * 60 * 1000;

        if (this.refresh_token) this._session.refreshToken = this.refresh_token;
        if (this.access_token) this._session.accessToken = this.access_token;
    }

    _clear_session(){
        if (!this._session) return

        this._session.cancelLoginAttempt()
        this._session.removeAllListeners();
        this._session = null;
    }

    get session(){
        if (this._session && this._session._accessTokenSetAt){
            const timeNow = Date.now();
            const sessionTime = this._session._accessTokenSetAt.getTime();
            if (timeNow - sessionTime >= 8 * 60 * 1000) this._clear_session();
        }

        if (!this._session) this._init_session()

        return this._session;
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

        this._clear_session();

        try{
            const options = {accountName, password};
            const code = this.auth_code
            if (code) options.steamGuardCode = code
            
            const result = await this.session.startWithCredentials(options);

            this.steamID = this._session.steamID.toString();
            this.__process_session_events();
            if (result.actionRequired){
                this._weak_token = this._session._startSessionResponse.weakToken
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
        }catch(_error){
            let error = _error.message;

            if (error == "InvalidPassword") error = "Incorrect login or password";
            if (error == "RateLimitExceeded") error = "Request limit exceeded";
            if (error == "AccountLoginDeniedThrottle") error = "The number of attempts has been exceeded. Try later"

            return {success: false, error}
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
                const _access = item.split("=")[1].replace(`${this.steamID}%7C%7C`, "");
                const login_obj = decodeJwt(_access);
                const time = Math.floor(Date.now()/1000)
                if (login_obj.exp - time > 10*60){
                    if (_access == this.access_token) return {success: true, cookies: this.cookies, updated: false};
                    else {
                        this.refresh_token = null;
                        this.access_token = null;
                        this.cookies = []
                        return {success: false, error: "Session invalid"};
                    }
                } 
            }
        }
        
        if (!this.proxy.status) return {success: false, error: "Proxy is broken"}

        try{
            this.cookies = await this.session.getWebCookies()
            if (this.cookies.length){
                if (this._steam_store) this._steam_store.setCookies(this.cookies)
                if (this._community) this._community.setCookies(this.cookies)
            }
            if (!this.access_token) this.access_token = this._session.accessToken;

            return {success: true, cookies: this.cookies, updated: true}
        }catch(error){
            console.log(error)
            if (error.message == "AccessDenied"){
                this.refresh_token = null;
                this.access_token = null;
                return {success: false, error: error.message}
            }
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
            console.log(error.message)
            if (error.message == "AccessDenied"){
                this.refresh_token = null;
                this.access_token = null;
                return {success: false, error: error.message}
            }
            if (repeat) await this.refresh_access_token(repeat)
            else return {success: false, error: error.message}
        }
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
        }catch(error){
            //console.log(this.account_name, "renevalRefreshToken", error.message)
            await new Promise(res=>{
                this.__reneval_refresh_timeout = setTimeout(res, 30000)
            })
            return this.reneval_refresh_token();
        }
    }

    async update_session(){
        const result = await this.get_cookies();
        if (result.updated) this.emit("update");
        return result;
    }

    async qr_auth(url){
        if (!this.refresh_token || !this.two_fa.shared_secret || !url) return {success: false, error: "Can't approved"};
        if (!this.proxy.status) return {success: false, error: "Proxy is broken"}
        const updater = await this.refresh_access_token();
        if (!updater.success) return updater
        const options = this.proxy.proxy ? {httpProxy: this.proxy.proxy} : {};
        const approver = new SteamSession.LoginApprover(this.access_token, this.two_fa.shared_secret, options);

        try{
            await approver.approveAuthSession({qrChallengeUrl: url, approve: true})
            return {success: true}
        }catch(error){
            console.log("qr", error.message)
            if (error.message == "WebAPI error 401"){
                this.refresh_token = null;
                this.access_token = null;
            }
            return {success: false, error: error.message};
        }
    }

    async sessionRequest(request){
        if (!this._session) throw new Error("Session is not active")
		// If a transport close is pending, cancel it
		clearTimeout(this._session._handler._transportCloseTimeout);

		let {request: requestProto, response: responseProto} = getProtoForMethod(request.apiInterface, request.apiMethod);
		if (!requestProto || !responseProto) {
			throw new Error(`Unknown API method ${request.apiInterface}/${request.apiMethod}`);
		}

		let {headers} = this._session._handler._getPlatformData();
		this._session._handler.emit('debug', request.apiMethod, request.data, headers);

		let result = await this._session._handler._transport.sendRequest({
			apiInterface: request.apiInterface,
			apiMethod: request.apiMethod,
			apiVersion: request.apiVersion,
			requestData: requestProto.encode(request.data).finish(),
			accessToken: request.accessToken,
			headers
		});

		if (result.result != EResult.OK) {
			throw eresultError(result.result, result.errorMessage);
		}

		// We need to decode the response data, if there was any
		let responseData = result.responseData && result.responseData.length > 0 ? result.responseData : Buffer.alloc(0);
		let decodedData = responseProto.decode(responseData);
		return responseProto.toObject(decodedData, {longs: String});

        function getProtoForMethod(apiInterface, apiMethod){
            let signature = [apiInterface, apiMethod].join('_');
            let protoDefinitionName = `C${signature}`;
        
            let requestDefinitionName = `${protoDefinitionName}_Request`;
            let responseDefinitionName = `${protoDefinitionName}_Response`;
        
            let request = Protobuf[requestDefinitionName];
            let response = Protobuf[responseDefinitionName];
        
            return {request, response};
        }

        function eresultError(result, errorMessage){
            let resultMsg = result.toString(); // this is the numeric value, as a string
            resultMsg = EResult[resultMsg] || resultMsg; // this is now the string representation of the EResult value
        
            let err = new Error(errorMessage || resultMsg);
            // @ts-ignore
            err.eresult = result;
            return err;
        }
	}

    __process_session_events(){
        const end = (_error = "")=>{
            this._login_status.wait = false;
            this._login_status.success = !_error;
            this._login_status.error = _error;

            this._session.removeAllListeners();
        }


        this._session.on("error", error=> end(error.message))

        this._session.on("timeout", ()=> end('Timeout'))

        this._session.on("authenticated", async ()=>{
            this.access_token = this._session.accessToken;
            this.refresh_token = this._session.refreshToken;
            this.account_name = this._session.accountName;
            await this.get_cookies(false);
            end()
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
            nickname: this._nickname,
            Session: {
                SteamID: this.steamID
            }
        }
    }

    stop(){
        this.removeAllListeners();
        this._clear_session();
        this.proxy.stop();
        if (this.__reneval_refresh_timeout) clearTimeout(this.__reneval_refresh_timeout)
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