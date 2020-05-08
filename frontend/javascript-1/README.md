# JavaScript

## [⚠️](https://emojipedia.org/warning/) Quirks and Gotchas! [⚠️](https://emojipedia.org/warning/)

**Level: Expert**  
There are an increasing number of people who write JavaScript without trailing semicolons. I am now one of those weirdos. It is more efficient. The creator of NPM, and other big names in the industry are gung-ho this new convention. Turns out writing JavaScript without trailing semicolons is much easier and more efficient! Most of the discussion is about sticking to the existing convention or not. Doing it for a while now, I have only come across one pitfall, which is actually an anti-pattern, so it can not even be used as an argument in favor of semicolons. But still, fellow no-semicolon people, watch out for:  
`global['debug'] = console` . If you do not put the semicolon after console, Prettier will break your script. As of May 2020. 

**Level: Beginner FullStack**  
The first paragraph brings up another interesting quirk and gotcha -- the global variable. In the browser, you have the variable `window`, properties of which are available in all included script files, without even mentioning "window.myVar". In Node.JS, you have actually two \(at least\): `process` and `global`. Process contains system properties like `process.env`, `process.exit`, etc., similar to the browser `window.location`, `window.screen`, etc. Discussion on whether or not to set your own custom properties directly onto window, or global, or process, is another topic -- covered in "anti-patterns".



