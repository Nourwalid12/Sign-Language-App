Add-Type -AssemblyName System.Speech

$projectRoot = Split-Path -Parent $PSScriptRoot
$voiceRoot = Join-Path $projectRoot 'public\sign-voices'
$voices = @{
  en = 'Microsoft Zira'
  ar = 'Microsoft Hoda'
}

$phrases = @{
  en = [ordered]@{
    ready = 'Voice is ready.'
    bye = 'Bye'
    hello = 'Hello'
    i = 'I'
    no = 'No'
    perfect = 'Perfect'
    'thank-you' = 'Thank you'
    yes = 'Yes'
    help = 'Help'
    'i-love-you' = 'I love you'
    my = 'My'
    name = 'Name'
    want = 'Want'
    'number-0' = 'Zero'
    'number-1' = 'One'
    'number-2' = 'Two'
    'number-3' = 'Three'
    'number-4' = 'Four'
  }
  ar = [ordered]@{
    ready = 'الصوت يعمل الآن'
    bye = 'مع السلامة'
    hello = 'مرحباً'
    i = 'أنا'
    no = 'لا'
    perfect = 'ممتاز'
    'thank-you' = 'شكراً'
    yes = 'نعم'
    help = 'مساعدة'
    'i-love-you' = 'أحبك'
    my = 'لي'
    name = 'اسم'
    want = 'أريد'
    'number-0' = 'صفر'
    'number-1' = 'واحد'
    'number-2' = 'اثنان'
    'number-3' = 'ثلاثة'
    'number-4' = 'أربعة'
  }
}

foreach ($language in @('en', 'ar')) {
  $languageRoot = Join-Path $voiceRoot $language
  New-Item -ItemType Directory -Path $languageRoot -Force | Out-Null

  $synthesizer = New-Object System.Speech.Synthesis.SpeechSynthesizer
  try {
    $synthesizer.SelectVoice($voices[$language])
    $synthesizer.Rate = 0
    $synthesizer.Volume = 100

    foreach ($entry in $phrases[$language].GetEnumerator()) {
      $outputPath = Join-Path $languageRoot ($entry.Key + '.wav')
      $synthesizer.SetOutputToWaveFile($outputPath)
      $synthesizer.Speak($entry.Value)
      $synthesizer.SetOutputToNull()
      Write-Output "Wrote $outputPath"
    }
  } finally {
    $synthesizer.Dispose()
  }
}
