property heliumExecutable : "/Applications/Helium.app/Contents/MacOS/Helium"
property canvasFeatures : "CanvasDrawElement,CanvasDrawElementInSubtree"
property prototypeURL : "http://127.0.0.1:4174/"

on run
	set heliumIsRunning to (do shell script "/usr/bin/pgrep -x Helium >/dev/null 2>&1; printf '%s' $?") is "0"
	
	if heliumIsRunning then
		set restartChoice to display dialog "Helium must restart to enable HTML-in-Canvas. Your normal Helium profile and tabs will be preserved." with title "Helium Canvas" buttons {"Cancel", "Restart Helium"} default button "Restart Helium" cancel button "Cancel" with icon caution
		if button returned of restartChoice is not "Restart Helium" then return
		
		do shell script "/usr/bin/pkill -TERM -x Helium >/dev/null 2>&1 || true"
		repeat 40 times
			delay 0.25
			if (do shell script "/usr/bin/pgrep -x Helium >/dev/null 2>&1; printf '%s' $?") is not "0" then exit repeat
		end repeat
	end if
	
	set launchCommand to quoted form of heliumExecutable & " --enable-blink-features=" & quoted form of canvasFeatures & " " & quoted form of prototypeURL & " >/dev/null 2>&1 &"
	do shell script launchCommand
end run
