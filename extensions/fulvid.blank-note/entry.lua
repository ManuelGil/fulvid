-- Seed an untitled Markdown buffer. Date is a placeholder the user edits
-- (host has no date helper; os is unavailable in the guest).
commands.register({
  id = "createBlankNote",
  title = "Extensions: New blank note",
  run = function()
    document.createUntitled("# Note\n\nDate: YYYY-MM-DD\n\n## Notes\n\n-\n")
    ui.notify("Created blank note.")
  end
})
