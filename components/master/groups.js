module.exports = class Groups{
    list = new Map();

    change(steamID, newG = [], oldG = []){

        const _oldG = oldG.length ? oldG.filter(val=> !newG.includes(val)) : newG.length ? ["Others"] : [];

        _oldG.forEach(name=>{
            if (!this.list.has(name)) return;

            const group = this.list.get(name);
            group.accounts.delete(steamID);
            if (!group.accounts.size) this.list.delete(name);
        })

        if (!newG.length){
            if (!this.list.has("Others")) this.list.set("Others", this._new("Others", 1, Infinity))
            const group = this.list.get("Others");
            group.accounts.add(steamID);
            return;
        }

        newG.forEach(name=>{
            if (!this.list.has(name)) this.list.set(name, this._new(name, 1))
            const group = this.list.get(name);
            group.accounts.add(steamID);
        })
    }

    state(name, state = 1){
        const group = this.list.get(name);
        if (!group) return;
        group.state = state;
    }

    position(name, position = 1){
        if (!position) return;
        const group = this.list.get(name);
        if (!group) return;
        group.position = position;
    }

    getState(){
        const result = {};
        this.list.forEach(group=>{
            result[group.name] = {state: group.state, position: group.position}
        })
        return result;
    }

    setState(obj = {}){
        for (let name in obj){
            this.state(name, obj[name].state)
            this.position(name, obj[name].position)
        }
    }

    get(){
        if (this.list.size == 1) return [];

        const result = Array.from(this.list.values()).map(group=>{
            return {
                name: group.name,
                position: group.position,
                state: group.state,
                accounts: Array.from(group.accounts)
            }
        })
        result.sort((a,b)=> a.position - b.position);
        return result
    }

    _new(name, state = 1, position = 0){
        return {
            name,
            state,
            position: position || this.list.size + 1,
            accounts: new Set()
        }
    }
}