const Account = require("./steam");
const Proxy = require("./steam/proxy");
const fs = require("fs").promises;
const path = require("path");
const jsQR = require('jsqr');

class Master{
    data_dir = path.join(process.cwd(), "data");
    accounts = {};
    accounts_name = {};
    import_accounts = {};
    proxy = {};
    new_account = null;

    async init(){
        const result = []
        try{
            const dir = await fs.readdir(this.data_dir, {encoding: "utf-8"})
            for (const name of dir){
                const res = await this.load_account(name);
                result.push(res);
            }
        }catch(error){
            await fs.mkdir(this.data_dir);
            return []
        }
        return result;
    }

    async load_account(id){
        try{
            const file = await fs.readFile(path.join(this.data_dir, id), {encoding: "utf-8"});
            const account = JSON.parse(file);
            this.accounts[account.steamID] = new Account(account);
            this.accounts[account.steamID].on("update", ()=>{
                this.save_account(account.steamID)
            })
            this.accounts_name[account.account_name] = 1;
            return {success: true, id}
        }catch(error){
            return {success: false, error: error.message, id}
        }
    }

    async save_account(id){
        if (!this.accounts[id]) return {success: false, error: "Account not found"}

        const data = JSON.stringify(this.accounts[id].object4save(), null, "\t");
        try{
            const f_path = path.join(this.data_dir, id)
            await fs.writeFile(f_path, data, {encoding: "utf-8"});
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

            if (skip_dupl && this.accounts_name[account.account_name]) return
            this.import_accounts[account.account_name] = account;
            return {success: true, login: account.account_name, file_name: dir.base}
        }

        const result = [];

        for(let i=0;i<_path.length; i++){
            const res = await read_file(_path[i]);
            if (res) result.push(res)
            // else{
            //     const dir = path.parse(_path[i]);
            //     result.push({success: false, error: "Duplicate", file_name: dir.base})
            // }
        }
        return result;
    }
    async import_login(login, password, proxy = null){
        if (!this.import_accounts.hasOwnProperty(login)) return {success: false, error: "Not imported"}

        const maData = this.import_accounts[login];
        const account = new Account({...maData, proxy}, 1);
        const result = await account.login(password)
        if (result.success){
            if (result.status == 1){
                this.accounts[account.steamID] = account;
                this.accounts[account.steamID].on("update", ()=>{
                    this.save_account(account.steamID)
                })
                this.accounts_name[account.account_name] = 1;
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
        await this.accounts[id].update_session();
        return this.accounts[id].load_confirmations();
    }

    async respond_confirmations({id, items = [], accept = true}){
        if (!this.accounts[id]) return {success: false, error: "Account not found"}
        const result = await this.accounts[id].respond_confirmations(items, accept);
        if (!result.success) return result;
        else return {success: true, confirmations: this.accounts[id].confirmations}
    }

    async add_new(data){
        console.log(data)
        const {stage} = data;
        if (stage == 1){
            this.new_account = new Account(data, 2);
            return this.new_account.login(data.password);
        }else if (stage == 1.1) return this.new_account.set_guard_code(data.code);
        else if(stage == 2) return this.new_account.has_phone()
        else if(stage == 2.1) return this.new_account.add_phone_number(data.number);
        else if (stage == 2.2) return this.new_account.send_sms();
        else if (stage == 2.3) return this.new_account.resend_sms();
        else if (stage == 2.4) return this.new_account.confirm_phone(data.code);
        else if (stage == 3) return this.new_account.activate_2fa();
        else if (stage == 3.1){
            const result = await this.new_account.finalize_2fa(data.code);
            if (result.success){
                const steamID = this.new_account.steamID;
                this.accounts[steamID] = new Account(this.new_account.object4save());
                this.accounts[steamID].on("update", ()=>{
                    this.save_account(steamID)
                })
                this.new_account = null;
                this.save_account(steamID);
                return {success: true}
            }else return result;
        }
    }

    get_config(data){
        if (data.id){
            return {
                auto_confirm: this.accounts[data.id].auto_confirm,
                proxy: this.accounts[data.id].proxy.full
            }
        }else {
            let auto_confirm = false;
            for (let id in this.accounts){
                if (this.accounts[id].auto_confirm){
                    auto_confirm = true
                    break
                } 
            }
            return {
                auto_confirm,
                confirm_interval: 30
            }
        }
        return {}
    }

    set_config(data){
        if (!data.id || !this.accounts.hasOwnProperty(data.id)) return {success: false, error: "Bad ID account"};
        this.accounts[data.id].auto_confirm = data.auto_confirm;
        this.accounts[data.id].proxy = data.proxy;
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
}

module.exports = new Master();