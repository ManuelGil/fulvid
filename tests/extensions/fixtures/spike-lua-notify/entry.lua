-- Phase 2 spike: register a notify command. Not a permanent product fixture.
commands.register({
  id = "ping",
  title = "Lua Ping",
  run = function()
    ui.notify("pong")
  end
})
