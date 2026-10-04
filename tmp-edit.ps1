$f='index.html'; $t=[IO.File]::ReadAllText($f)
$nl=if($t.Contains("`r`n")){"`r`n"}else{"`n"}
$t=$t.Replace("`r`n","`n")
function rep($a,$b){ if(-not $script:t.Contains($a)){throw "missing: $a"}; $script:t=$script:t.Replace($a,$b) }
rep "      <section class=`"grid`">`n        <article class=`"panel span-12`">" "      <section class=`"grid`" data-site-layout=`"page-grid`">`n        <article class=`"panel span-12`" data-site-section=`"games`" data-editor-section-label=`"Games In Rotation`">"
rep "      grid-template-columns: repeat(3, minmax(0, 1fr));`n      gap: 14px;" "      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));`n      gap: 14px;"
$old = @'
data-site-content="gameBadLinkLabel">Open speedrun.com</a>
            </div>
'@
$new = @'
data-site-content="gameBadLinkLabel">Open speedrun.com</a>
            </div>
            <div class="game-card" data-site-section="game-bubsy-4d" data-editor-section-label="Bubsy 4D">
              <h3 data-site-content="gameBubsyTitle" data-editor-label="Bubsy 4D title">Bubsy 4D</h3>
              <p data-site-content="gameBubsyDescription" data-editor-label="Bubsy 4D description">Another game I run.</p>
              <a href="https://www.speedrun.com/Bubsy_4D" data-site-link="gameBubsyUrl" data-editor-label="Bubsy 4D link URL" target="_blank" rel="noopener" data-site-content="gameBubsyLinkLabel">Open speedrun.com</a>
            </div>
'@
rep $old $new
rep 'site-editor.js?v=20261004-r8' 'site-editor.js?v=20261004-r9'
$t=$t.Replace("`n",$nl)
[IO.File]::WriteAllText($f,$t)
$f='js\site-editor.js'; $t=[IO.File]::ReadAllText($f)
$t=$t.Replace('"game-cards": "Game cards"', '"game-cards": "Game cards", "page-grid": "Page sections"')
[IO.File]::WriteAllText($f,$t)
