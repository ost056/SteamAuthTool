
const ignore_list = ['app.js', "ui", ".vscode", ".gitignore", 'forge.config.js', 'vetur.config.js', "logo.png", "test.json", "shema.json", "data", "states.json", "backup", ".git", "node_modules/@electron", "node_modules/electron"]

module.exports = {
	packagerConfig: {
		asar: true,
		name: "Steam Auth Tool",
		icon: "logo",
		ignore: (path)=>{
			for (let item of ignore_list){
				if (path.startsWith(`/${item}`)) return true 
			}
			return false
		},
		arch: process.platform === 'darwin' ? 'universal' : 'x64, arm64',
    	platform: process.platform, // Платформа автоматически подставится
	},
	rebuildConfig: {},
	makers: [
		{
			name: '@electron-forge/maker-squirrel',
			config: {
				setupIcon: 'logo.ico', // Укажите путь к иконке для Windows
			},
			platforms: ['win32'],
		},
		{
			name: '@electron-forge/maker-zip',
			platforms: ['win32'], // zip для macOS и Windows
		},
		{
			name: '@electron-forge/maker-dmg', // Добавление DMG maker
			config: {
				format: 'ULFO', // Сжимаем для уменьшения размера
			},
		},
		{
			name: '@electron-forge/maker-deb',
			config: {
				options: {
					icon: 'logo.png', // иконка для Linux
				},
			},
			platforms: ['linux'],
		},
		{
			name: '@electron-forge/maker-rpm',
			config: {
				options: {
					icon: 'logo.png',
				},
			},
			platforms: ['linux'],
		},
	],
	plugins: [
		{
			name: '@electron-forge/plugin-auto-unpack-natives',
			config: {},
		},
	],
};