module.exports = {
  daemon: true,
  run: [
    {
      method: "shell.run",
      params: {
        env: {
          HEISS_NO_BROWSER: "1"
        },
        path: "app",
        message: "npm start",
        on: [{
          event: "/(http:\\/\\/(?:localhost|[0-9.:]+))\/",
          done: true
        }]
      }
    },
    {
      method: "local.set",
      params: {
        url: "{{input.event[1]}}"
      }
    }
  ]
};
