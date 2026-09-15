-- Minimal ui.notify bridge. No editor/document authority.
commands.register({
  id = "sayReady",
  title = "Extensions: Confirm extensions loaded",
  run = function()
    ui.notify("Extensions are available. This pack used only the host notify owner.")
  end
})
