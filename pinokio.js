module.exports = {
  version: "7.0",
  title: "HEISS UI",
  description: "A local prompt-and-gallery studio for ComfyUI.",
  icon: "icon.png",
  menu: async (kernel, info) => {
    const installed = info.exists("app/node_modules") && info.exists("app/dist/index.html");
    const running = {
      install: info.running("install.js"),
      start: info.running("start.js"),
      update: info.running("update.js"),
      reset: info.running("reset.js")
    };

    if (running.install) {
      return [{ default: true, icon: "fa-solid fa-plug", text: "Installing", href: "install.js" }];
    }
    if (installed && running.start) {
      const local = info.local("start.js");
      if (local && local.url) {
        return [
          { default: true, icon: "fa-solid fa-rocket", text: "Open HEISS UI", href: local.url },
          { icon: "fa-solid fa-terminal", text: "Terminal", href: "start.js" }
        ];
      }
      return [{ default: true, icon: "fa-solid fa-terminal", text: "Starting HEISS UI", href: "start.js" }];
    }
    if (running.update) {
      return [{ default: true, icon: "fa-solid fa-terminal", text: "Updating", href: "update.js" }];
    }
    if (running.reset) {
      return [{ default: true, icon: "fa-solid fa-terminal", text: "Repairing install", href: "reset.js" }];
    }
    if (installed) {
      return [
        { default: true, icon: "fa-solid fa-power-off", text: "Start", href: "start.js" },
        { icon: "fa-solid fa-plug", text: "Update", href: "update.js" },
        { icon: "fa-solid fa-wrench", text: "Repair install", href: "reset.js" }
      ];
    }
    return [{ default: true, icon: "fa-solid fa-plug", text: "Install", href: "install.js" }];
  }
};
