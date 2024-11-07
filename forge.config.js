
const ignore_list = ['app.js', "ui", ".vscode", ".gitignore", 'forge.config.js', 'vetur.config.js', "logo.png", "test.json", "shema.json", "data", "states.json", "backup", ".git", "node_modules/@electron", "node_modules/electron"]

module.exports = {
	packagerConfig: {
		asar: true,
		name: "Steam Auth Tool",
		icon: "logo.ico",
		ignore: (path)=>{
			for (let item of ignore_list){
				if (path.startsWith(`/${item}`)) return true 
			}
			return false
		}
	},
	rebuildConfig: {},
	makers: [
		{
			name: '@electron-forge/maker-squirrel',
			config: {},
		},
		{
			name: '@electron-forge/maker-zip',
			platforms: ['darwin', "win"],
		},
		{
			name: '@electron-forge/maker-deb',
			config: {},
		},
		{
			name: '@electron-forge/maker-rpm',
			config: {},
		},
	],
	plugins: [
		{
			name: '@electron-forge/plugin-auto-unpack-natives',
			config: {},
		},
	],
};