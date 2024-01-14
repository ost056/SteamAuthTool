const {protocol, session } = require("electron");
const pathes = {};

module.exports = (scheme, options, partition)=>{
    
    protocol.registerSchemesAsPrivileged([
        {
          scheme,
          privileges: options
        }
    ])

    
    return {
        set: (path, callback)=>{
            pathes[path] = callback
        },
        init: ()=>{
            const ses = session.fromPartition(partition);
            ses.protocol.handle(scheme, async req=>{
                //console.log(req);
                let body = null;
                if (req.body){
                    for await (const chunk of req.body)
                        body = Buffer.from(chunk).toString();
                    
                    body = JSON.parse(body)
                }
                const res = {
                    json: (val)=>{
                        return new Response(JSON.stringify(val, null, "\t"), {headers: { 'content-type': 'json' }})
                    },
                    send: (val)=>{
                        return new Response(val, {headers: { 'content-type': 'text/html' }})
                    }
                }
                const url = new URL(req.url)
                const callback = pathes[url.pathname];
                if (!callback) return res.json({success:false, error: "Bad request"})
                
                return await callback(body, res)
            })
        }
    }
}