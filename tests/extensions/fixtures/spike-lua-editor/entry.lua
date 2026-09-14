-- Phase 3 disposable fixture: wrap primary selection in markdown bold markers.
commands.register({
  id = "wrapBold",
  title = "Lua Wrap Bold",
  run = function()
    local selection = editor.getSelection()
    if selection == "" then
      ui.notify("no selection")
      return
    end
    editor.replaceSelection("**" .. selection .. "**")
    ui.notify("wrapped")
  end
})
