const { app, BrowserWindow, dialog, clipboard, shell} = require('electron');

const Transport = require("./components/transport");

const APP_INFO = {
    title: "Steam Auth Tool",
    version: "v0.2 beta",
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

let WINDOW = null


const createWindow = async () => {
    const win = new BrowserWindow({
        width: 800,
        height: 630,
        webPreferences: {
            preload: path.join(__dirname, 'preloader.js'),
            partition: PARTITION
        },
        resizable: false,
        fullscreenable: false,
        frame: false,
        icon: "./logo.ico"
    })
    win.hide()
    if (DEV){
        await win.loadURL("http://localhost:8080")
        win.webContents.openDevTools()
    }else await win.loadFile("./GUI/index.html")
    win.show();
    WINDOW = win

    win.on('window-all-closed', () => {
        if (process.platform !== 'darwin') app.quit()
    })
}

Promise.all([app.whenReady(), master.init()]).then(() => {
    initTransport()
    createWindow()
})

function initTransport(){
    transport.set("/app", (data, res)=>{
        return res.json(APP_INFO)
    })

    transport.set("/close", (data, res)=>{
        WINDOW.close();
        WINDOW.destroy();
        return res.json({})
    })

    transport.set("/minimize", (data, res)=>{
        WINDOW.minimize()
        return res.json({})
    })

    transport.set("/open-url", (data, res)=>{
        shell.openExternal(data.url);
        return res.json({});
    })

    transport.set("/import", async (data, res)=>{
        const dir = await dialog.showOpenDialog({title: "test", properties: ['multiSelections']}).catch();
        if (dir.filePaths.length){
            return res.json({path: dir.filePaths});
        } 
        else return res.json({path: []});
    })

    transport.set("/cont-import", async (data, res)=>{
        const result = await master.import(data.path, data.skip_dubl)
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