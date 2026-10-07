$instance = "mar-brasil-oficial"
$apiKey   = "minha_chave_secreta_123"
$ngrokUrl = "https://armoire-turban-regulate.ngrok-free.dev"

$headers = @{
    apikey                       = $apiKey
    "ngrok-skip-browser-warning" = "true"
}

$response = Invoke-RestMethod -Uri "$ngrokUrl/instance/connect/$instance" -Headers $headers -Method GET

$qrText = $null
if ($response.code)   { $qrText = $response.code }
if ($response.base64 -and -not $qrText) { $qrText = $response.base64 }

if (-not $qrText) {
    Write-Host "ERRO: API nao retornou QR Code. Resposta:"
    $response | ConvertTo-Json -Depth 5
    exit 1
}

# Gera URL da imagem via qrserver.com
$encoded   = [uri]::EscapeDataString($qrText)
$qrImgUrl  = "https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=$encoded"

# Baixa a imagem PNG diretamente
$outPng = Join-Path $PSScriptRoot "qr_whatsapp.png"
Invoke-WebRequest -Uri $qrImgUrl -OutFile $outPng -UseBasicParsing

Write-Host "QR Code salvo: $outPng"
Start-Process $outPng
