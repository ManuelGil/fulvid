-- Test-only editor fixture: wrap primary selection in markdown bold markers.
-- Not a product example (core already owns bold). Used by contract tests only.
commands.register({
  id = "wrapBold",
  title = "Wrap Bold",
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
