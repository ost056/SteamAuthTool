const { app, BrowserWindow, dialog, clipboard, shell} = require('electron');

const Transport = require("./components/transport");

const APP_INFO = {
    title: "Steam Auth Tool",
    version: "v1.1",
    short_title: "SAT"
}

const DEV = false;


const path = require('path')
const master = require("./components/master");
const PARTITION = "node-sda:main";

const transport = Transport("node-sda", {
    standard: true,
    secure: true,
    supportFetchAPI: true
}, PARTITION)

let mainWindow = null


const createWindow = async () => {
    const win = new BrowserWindow({
        width: 800,
        height: 630,
        webPreferences: {
            partition: PARTITION
        },
        resizable: false,
        fullscreenable: false,
        frame: false,
        icon: path.join(__dirname,"logo.ico"),
        show: false
    })
    win.once("ready-to-show", ()=>{
        win.show();
    })
    if (DEV){
        await win.loadURL("http://localhost:8080")
        win.webContents.openDevTools()
    }else await win.loadFile("./GUI/index.html")

    win.on('window-all-closed', () => {
        if (process.platform !== 'darwin') app.quit()
    })

    return win
}

Promise.all([app.whenReady(), master.init()]).then(async () => {
    initTransport()
    mainWindow = await createWindow();
})

function initTransport(){
    transport.set("/app", (data, res)=>{
        return res.json({...APP_INFO, crypted: !!master.crypted_files.length})
    })

    transport.set("/close", (data, res)=>{
        mainWindow.close();
        mainWindow.destroy();
        return res.json({})
    })

    transport.set("/minimize", (data, res)=>{
        mainWindow.minimize()
        return res.json({})
    })

    transport.set("/open-url", (data, res)=>{
        shell.openExternal(data.url);
        return res.json({});
    })

    transport.set("/send-password", async (data, res)=>{
        const result = await master.set_crypto_password(data.password)
        return res.json(result);
    })

    transport.set("/crypto-enable", async (data, res)=>{
        const result = await master.enable_crypto(data)
        return res.json(result);
    })

    transport.set("/crypto-status", async(data, res)=>{
        return res.json(master.crypto_status());
    })

    transport.set("/import", async (data, res)=>{
        const dir = await dialog.showOpenDialog({title: "Select account files", properties: ['multiSelections']}).catch();
        if (dir.filePaths.length){
            return res.json({path: dir.filePaths});
        } 
        else return res.json({path: []});
    })

    transport.set("/cont-import", async (data, res)=>{
        const result = await master.import(data.path, data.skip_dupl)
        return res.json(result)
    })

    transport.set("/import-login", async (data, res)=>{
        const result = await master.import_login(data.login, data.password, data.proxy, data.tags);
        return res.json(result);
    })

    transport.set("/get-account", (data, res)=>{
        return res.json(master.get_account(data.id))
    })

    transport.set("/copy-code", (data, res)=>{
        const info = master.get_account(data.id)
        clipboard.writeText(info.code);
        return res.json({})
    })

    transport.set("/copy-qr", async (data, res)=>{
        const img = clipboard.readImage();
        const result = await master.qr_auth(img, data.id)
        return res.json(result)
    })

    transport.set("/load-confirmations", async (data, res)=>{
        const result = await master.load_confirmations(data.id)
        return res.json(result);
    })

    transport.set("/respond-confirmations", async (data, res)=>{
        const result = await master.respond_confirmations(data);
        return res.json(result)
    })

    transport.set("/confirmation-info", async (data, res)=>{
        const result = await master.confirmation_info(data)
        return res.json(result)
    })

    transport.set("/add-new", async (data, res)=>{
        const result = await master.add_new(data);
        console.log(result)
        return res.json(result);
    })

    transport.set('/get-config', async (data, res)=>{
        const result = master.get_config(data);
        return res.json(result);
    })

    transport.set('/set-config', async (data, res)=>{
        const result = master.set_config(data);
        return res.json(result)
    })

    transport.set('/turn-auto-confirmation', (data, res)=>{
        master.auto_confirm(data)
        return res.json({})
    })

    transport.set('/relogin', async (data, res)=>{
        const result = await master.relogin(data);
        return res.json(result);
    })

    transport.set("/getlist", (data, res)=>{
        const accounts = []
        const tags = [];
        for (let id in master.accounts){
            master.accounts[id].tags.forEach(tag=>{
                if (!tag) return
                if (!tags.includes(tag)) tags.push(tag)
            })
            accounts.push({
                id, 
                login: master.accounts[id].account_name, 
                proxy: master.accounts[id].proxy.toString(), 
                proxy_status: master.accounts[id].proxy.status, 
                auto_conf: master.accounts[id].auto_confirm,
                token_valid: !!master.accounts[id].refresh_token,
                tags: master.accounts[id].tags
            })
        }
        return res.json({accounts, tags})
    })

    transport.set("/check-proxy", async (data, res)=>{
        const result = await master.check_proxy(data.proxy);
        return res.json(result)
    })

    transport.set("/remove-account", (data, res)=>{
        master.remove_account(data.id)
        return res.json({})
    })
    transport.init();
}