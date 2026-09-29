module.exports = {
  run: [
    {
      method: "fs.rm",
      params: {
        path: "app/node_modules"
      }
    },
    {
      method: "fs.rm",
      params: {
        path: "app/dist"
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
