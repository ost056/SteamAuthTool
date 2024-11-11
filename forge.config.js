
const ignore_list = ['app.js', "ui", ".vscode", ".gitignore", 'forge.config.js', 'vetur.config.js', "logo.png", "test.json", "shema.json", "data", "states.json", "backup", ".git", "node_modules/@electron", "node_modules/electron"]

module.exports = {
	packagerConfig: {
		asar: false,
		name: "Steam Auth Tool",
		icon: "logo",
		ignore: (path)=>{
			for (let item of ignore_list){
				if (path.startsWith(`/${item}`)) return true 
			}
			return false
		},
		platform: ["darwin", "win32", "linux"]
	},
	rebuildConfig: {
		force: true
	},
	makers: [
		{
			name: '@electron-forge/maker-zip',
			platforms: ['darwin', 'win32', "linux"], // zip для macOS и Windows
		}
	],
};