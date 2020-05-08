# JavaScript

## [⚠️](https://emojipedia.org/warning/) Quirks and Gotchas! [⚠️](https://emojipedia.org/warning/)

There are an increasing number of people who write JavaScript without trailing semicolons. I am now one of those weirdos. It is more efficient. The creator of NPM, and other big names in the industry are for this new convention. Turns out writing JavaScript without trailing semicolons is much easier and more efficient! Most of the discussion is about sticking to the existing convention or not. Doing it for a while now, I have only come across one pitfall, which in itself is an anti-pattern, so it really should not be used as an argument in favor of semicolons. But still, fellow no-semicolon people, watch out for:  
`global['debug'] = console` . If you do not put the semicolon after console, Prettier will break your script. As of May 2020.

