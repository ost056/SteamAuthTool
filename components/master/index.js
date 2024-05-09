const Account = require("./steam");
const Proxy = require("./steam/proxy");
const fs = require("fs").promises;
const path = require("path");
const jsQR = require('jsqr');
const ROOT_DIR = process.cwd();
const {createCipheriv, createDecipheriv, scrypt} = require("crypto");
const iv = Buffer.from("737465616d2d617574682d746f6f6c5f", "hex");

class Master{
    data_dir = path.join(ROOT_DIR, "data");
    accounts = {};
    accounts_name = new Set();
    import_accounts = {};
    proxy = {};
    new_account = null;
    crypto_enable = false;
    crypto_key = null;
    crypted_files = []

    async init(){
        const result = []
        try{
            const dir = await fs.readdir(this.data_dir, {encoding: "utf-8"})
            const noMaf = dir.filter(val=> !val.includes(".maFile"));
            const files = dir.filter(val => val.includes(".maFile"))
            noMaf.forEach(item=>{
                if (files.includes(`${item}.maFile`)) fs.rm(path.join(this.data_dir, item))
                else files.push(item)
            })

            for (const name of files){
                const res = await this.load_account(name);
                result.push(res);
            }
        }catch(error){
            await fs.mkdir(this.data_dir);
            return []
        }
        return result;
    }

    file_is_crypted(file){
        try{
            const data = JSON.parse(file);
            return {crypted: false, valid: true, data}
        }catch(error){}

        try{
            const from_hex = Buffer.from(file, "base64").toString("utf-8");
            const valid = from_hex.includes(".SteamAuthTool")
            if (!valid) return {crypted: false, valid}
            const data = from_hex.replace(".SteamAuthTool", "")
            return {crypted: true, valid, data}
        }catch(error){
            return {crypted: false, valid: false}
        }
    }

    _encrypt(data){
        if (!this.crypto_key) return {success: false, error: "Empty password"}
        try{
            const cipher = createCipheriv('aes-192-cbc', this.crypto_key, iv);
            let encrypted = cipher.update(data, 'utf-8', 'hex');
            encrypted += cipher.final('hex');
            return {success: true, data: encrypted};
        }catch(error){
            return {success: false, error: error.message, data: ""}
        }
    }

    _decrypt(data, key = null){
        if (!this.crypto_key && !key) return {success: false, error: "Empty password"};
        try{
            const decipher = createDecipheriv('aes-192-cbc', this.crypto_key || key, iv);
            let decrypted = decipher.update(data, 'hex', 'utf-8');
            decrypted += decipher.final('utf-8');
            return {success: true, data: decrypted};
        }catch(error){
            return {success: false, error: error.message}
        }
    }

    async set_crypto_password(password){
        if (!password) return {success: false, error: "Empty password"}

        const key = await new Promise(res => {
            scrypt(password, 'salt', 24, (err, key) => {
                if (err) return res(null)
                res(key)
            })
        });

        if (this.crypted_files.length && key){
            const res = this._decrypt(this.crypted_files[0].data, key);
            if (res.success){
                this.crypto_key = key
                this.crypted_files.forEach(item=>{
                    const decrypt = this._decrypt(item.data)
                    if (decrypt.success) this.init_account(decrypt.data, false, item.filename);
                })
                this.crypted_files = []
                return {success: true}
            }else return {success: false, error: "Wrong password"}
        }else if (key){
            this.crypto_enable = true;
            this.crypto_key = key;
            for (let id in this.accounts){
                this.save_account(id)
            }
            return {success: true}
        }else return {success: false, error: "Failed to set password. Try another one"}
    }

    async enable_crypto({enable, password = ""}){
        if (!enable){
            if (this.crypto_enable){

                const key = await new Promise(res => {
                    scrypt(password, 'salt', 24, (err, key) => {
                        if (err) return res(null)
                        res(key)
                    })
                });
                if (this.crypto_key && key.toString("base64") !== this.crypto_key.toString("base64")) return {success: false, error: "Wrong password"}

                this.crypto_enable = false;
                this.crypto_key = null;
                for (let id in this.accounts){
                    await this.save_account(id)
                }
            }
            return {success: true}
        }else if (!password){
            if (this.crypto_key) return {success: true}
            return {success: false, error: "Password is empty"}
        } 
        
        return this.set_crypto_password(password);
    }

    async load_account(id){
        try{
            const file = await fs.readFile(path.join(this.data_dir, id), {encoding: "utf-8"});
            const {valid, crypted, data} = this.file_is_crypted(file)

            if (!valid) return {success: false, error: `File ${id} is invalid!`, id}

            if (!crypted) this.init_account(data, true, id);
            else{
                this.crypto_enable = true;
                this.crypted_files.push({data, filename: id});
            }
            return {success: true, id}
        }catch(error){
            return {success: false, error: error.message, id}
        }
    }

    init_account(account,  isJson = true, filename = ""){
        const _account = isJson ? account : JSON.parse(account)
        this.accounts[_account.steamID] = new Account(_account);
        this.accounts[_account.steamID].filename = filename;
        this.accounts[_account.steamID].on("update", ()=>{
            this.save_account(_account.steamID)
        })
        this.accounts_name.add(_account.account_name)
    }

    async save_account(id){
        if (!this.accounts[id]) return {success: false, error: "Account not found"}

        const obj = this.accounts[id].object4save()
        const data = JSON.stringify(obj, null, "\t");
        try{
            const crypto_file = this.crypto_enable && this.crypto_key ? this._encrypt(data).data : "";
            const base64_file = crypto_file ? Buffer.from(crypto_file+".SteamAuthTool", "utf-8").toString("base64") : ""
            const file = base64_file ? base64_file : data;
            let f_path = path.join(this.data_dir, this.accounts[id].filename);

            const new_filename = this.accounts[id]._nickname ? `${this.accounts[id]._nickname}.maFile` : `${id}.maFile`;

            if (this.accounts[id].filename != new_filename){
                await fs.rm(f_path).catch(error=> console.log(error));
                f_path = path.join(this.data_dir, new_filename);
                this.accounts[id].filename = new_filename
            }

            await fs.writeFile(f_path, file, {encoding: "utf-8"});
            return {success: true}
        }catch(error){
            console.log(error)
            return {success: false, error: error.message}
        }
    }

    async import(_path, skip_dupl = true){
        const read_file = async (f_path)=>{
            const dir = path.parse(f_path);
            const file_path = path.join(f_path);

            let file;
            try{
                file = await fs.readFile(file_path, {encoding: "utf-8"});
            }catch(error){
                return {success: false, error: error.message, file_name: dir.base}
            }

            let account;
            try{
                account = JSON.parse(file);
                if (account.hasOwnProperty("2fa") && !account.hasOwnProperty("shared_secret")) account = account["2fa"];
                if (!account.hasOwnProperty('shared_secret')) return {success: false, error: "Invalid maFile. Not found 'shared_secret' property", file_name: dir.base}
                if (!account.hasOwnProperty("account_name")) return {success: false, error: "Invalid maFile. Not found 'account_name' property", file_name: dir.base}
                if (!account.hasOwnProperty('identity_secret')) return {success: false, error: "Invalid maFile. Not found 'identity_secret' property", file_name: dir.base}
            }catch(error){
                return {success: false, error: "Invalid maFile. The file is encrypted or damaged", file_name: dir.base}
            }

            if (skip_dupl && this.accounts_name.has(account.account_name)) return 0
            this.import_accounts[account.account_name] = account;
            return {success: true, login: account.account_name, file_name: dir.base}
        }

        const result = [];

        for(let i=0;i<_path.length; i++){
            const res = await read_file(_path[i]);
            if (res) result.push(res)
        }

        return result;
    }
    async import_login(login, password, proxy = null, tags = []){
        if (!this.import_accounts.hasOwnProperty(login)) return {success: false, error: "Not imported"}

        const maData = this.import_accounts[login];
        const account = new Account({...maData, proxy}, 1);
        const result = await account.login(password)
        if (result.success){
            if (result.status == 1){
                if (this.accounts.hasOwnProperty(account.steamID)) this.accounts[account.steamID].stop()

                this.accounts[account.steamID] = account;
                this.accounts[account.steamID].tags = tags;
                this.accounts[account.steamID].on("update", ()=>{
                    this.save_account(account.steamID)
                })
                this.accounts_name.add(account.account_name)
                this.save_account(account.steamID)
                return result;
            }else return {success: false, error: "Guard disconnected"}
        }else return result;
    }

    async relogin({id, password}){
        if (!this.accounts.hasOwnProperty(id)) return {success: false, error: "Account not found"};
        if (!this.accounts[id].proxy.status) return {success: false, error: "Proxy is broken"}

        const result = await this.accounts[id].login(password);
        if (result.success){
            if (result.status == 1){
                this.save_account(id)
                return result;
            }else return {success: false, error: "Guard disconnected or just try again!"}
        }else return result;
    }

    get_account(id){
        if (!this.accounts[id]) return {success: false, error: "Account not found"};
        return {
            login: this.accounts[id].account_name,
            code: this.accounts[id].auth_code,
            auto_confirm: this.accounts[id].auto_confirm,
            code_end: Math.floor((Math.floor(Math.floor(Date.now()/1000) / 30) + 1) * 30),
            proxy: this.accounts[id].proxy.ip,
            proxy_status: this.accounts[id].proxy.status,
            token_valid: !!this.accounts[id].refresh_token
        }
    }

    async qr_auth(img, id){
        try{
            const bit_map = img.toBitmap()
            const {width, height} = img.getSize();
            const code = jsQR(new Uint8ClampedArray(bit_map), width, height);
            if (!code) return {success: false, error: "Failed to recognize QR-code. Try again"}
            console.log(code.data)
            if (!code.data.includes("s.team/q")) return {success: false, error: "The copied QR-code does not apply to Steam. Copy the QR-code from the Steam login page"}
            
            return await this.accounts[id].qr_auth(code.data)
        }catch(error){
            return {success: false, error: error.message};
        }
    }

    async load_confirmations(id){
        if (!this.accounts[id]) return {success: false, error: "Account not found"};
        console.log("update ses")
        const session_updater = await this.accounts[id].update_session();
        if (!session_updater.success) return session_updater
        const result = await this.accounts[id].load_confirmations();
        if (!result.success && result.error == "Not Logged In"){
            this.accounts[id].access_token = null;
            return this.load_confirmations(id)
        }else return result
    }

    async respond_confirmations({id, items = [], accept = true}){
        if (!this.accounts[id]) return {success: false, error: "Account not found"}
        const result = await this.accounts[id].respond_confirmations(items, accept);
        if (!result.success) return result;
        else return {success: true, confirmations: this.accounts[id].confirmations}
    }

    confirmation_info({id, confirmation_id}){
        if (!this.accounts[id]) return {success: false, error: "Account not found"}
        return this.accounts[id].load_confirmation_info(confirmation_id)
    }

    async add_new(data){
        const finish = ()=>{
            const steamID = this.new_account.steamID;
            
            this.new_account.stop();

            if (this.accounts.hasOwnProperty(steamID)) this.accounts[steamID].stop()

            this.accounts[steamID] = new Account(this.new_account.object4save());
            this.accounts[steamID].tags = data.tags;
            this.accounts[steamID].on("update", ()=>{
                this.save_account(steamID)
            })

            this.accounts_name.add(this.new_account.account_name)

            this.new_account = null;
            this.save_account(steamID);
            return {success: true}
        }


        const {stage} = data;

        if (stage == 1){
            if (this.accounts_name.has(data.login)) return {success: false, error: "This account has already been added. Remove it and try again"}

            if (this.new_account) this.new_account.stop();

            this.new_account = new Account(data, 2);
            return this.new_account.login(data.password);
        }
        else if (stage == 1.1) return this.new_account.set_guard_code(data.code);
        else if (stage == 1.2) return this.new_account.moveTwoFactorStart();
        else if (stage == 1.3){
            const result = await this.new_account.moveTwoFactorFinish(data.code);
            if (result.success){
                await this.new_account.set_guard_code(this.new_account.auth_code);
                finish()
            }
            return result;
        } 
        else if(stage == 2) return this.new_account.has_phone()
        else if(stage == 2.1) return this.new_account.add_phone_number(data.number);
        else if (stage == 2.2) return this.new_account.send_sms();
        else if (stage == 2.3) return this.new_account.resend_sms();
        else if (stage == 2.4) return this.new_account.confirm_phone(data.code);
        else if (stage == 3) return this.new_account.activate_2fa();
        else if (stage == 3.1){
            const result = await this.new_account.finalize_2fa(data.code);
            if (!result.success) return result;
            return finish();
        }
    }

    crypto_status(){
        return {
            encrypt_enable: this.crypto_enable,
            password_is_set: !!this.crypto_key
        }
    }

    get_config(data){
        if (data.id){
            return {
                auto_confirm: this.accounts[data.id].auto_confirm,
                proxy: this.accounts[data.id].proxy.full,
                tags: this.accounts[data.id].tags,
                nickname: this.accounts[data.id].nickname
            }
        }else {
            return {
                encrypt_enable: this.crypto_enable
            }
        }
        return {}
    }

    set_config(data){
        if (!data.id || !this.accounts.hasOwnProperty(data.id)) return {success: false, error: "Bad ID account"};
        this.accounts[data.id].auto_confirm = data.auto_confirm;
        this.accounts[data.id].proxy = data.proxy;
        this.accounts[data.id].tags = data.tags;
        if (data.nickname !== this.accounts[data.id].account_name) this.accounts[data.id].nickname = data.nickname
        this.save_account(data.id)
        return {success: true}
    }

    async check_proxy(proxy){
        const success = await Proxy.check_status(proxy);
        return {success}
    }

    auto_confirm({id, enable}){
        if (!this.accounts[id]) return {success: false, error: "Account not found"};
        this.accounts[id].auto_confirm = enable;
        this.save_account(id)
    }

    async remove_account(id){
        if (!this.accounts.hasOwnProperty(id)) return {success: false, error: "Account not found"};
        this.accounts[id].auto_confirm = false;
        const add_maf = this.accounts[id].isMaf ? ".maFile" : ""
        try{
            const f_path = path.join(this.data_dir, id+add_maf)
            await fs.rm(f_path);

            this.accounts_name.delete(this.accounts[id].account_name)
            this.accounts[id].stop();
            delete this.accounts[id];

            return {success: true}
        }catch(error){
            console.log(error)
            return {success: false, error: error.message}
        }
    }
}

module.exports = new Master();