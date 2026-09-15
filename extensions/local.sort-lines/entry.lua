-- Sort the primary selection's lines A→Z. Empty selection notifies without mutating.
local function split_lines(text)
  local lines = {}
  local start = 1
  while true do
    local index = string.find(text, "\n", start, true)
    if not index then
      table.insert(lines, string.sub(text, start))
      break
    end
    table.insert(lines, string.sub(text, start, index - 1))
    start = index + 1
  end
  return lines
end

commands.register({
  id = "sortLines",
  title = "Extensions: Sort selected lines",
  run = function()
    local selection = editor.getSelection()
    if selection == "" then
      ui.notify("Select lines to sort.")
      return
    end
    local lines = split_lines(selection)
    if #lines <= 1 then
      ui.notify("Select at least two lines to sort.")
      return
    end
    table.sort(lines)
    local ended_with_newline = string.sub(selection, -1) == "\n"
    local result = table.concat(lines, "\n")
    if ended_with_newline then
      result = result .. "\n"
    end
    editor.replaceSelection(result)
    ui.notify("Sorted " .. tostring(#lines) .. " lines.")
  end
})
