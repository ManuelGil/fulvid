-- Disposable Lua fixture: register a notify command. Not a permanent product fixture.
commands.register({
  id = "ping",
  title = "Lua Ping",
  run = function()
    ui.notify("pong")
  end
})
