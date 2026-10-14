Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "C:\Users\Financeiro 1\.gemini\antigravity-ide\scratch\relatorio-medicao-pmoc"
WshShell.Run """C:\Program Files\nodejs\node.exe"" proxy.js", 0, False
