module.exports = {
  run: [
    {
      method: "shell.run",
      params: {
        message: "git clone https://github.com/tristmeister/HEISS-UI.git app"
      }
    },
    {
      method: "shell.run",
      params: {
        path: "app",
        message: "npm ci --no-audit --no-fund"
      }
    },
    {
      method: "shell.run",
      params: {
        path: "app",
        message: "npm run build"
      }
    }
  ]
};
