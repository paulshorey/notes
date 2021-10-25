# HTML / JSX / XML

#### Replace a React Component in entire codebase:

`([\s<]+)Image([\s/>]+)` --> `$1Picture$2`&#x20;



**Replace React NextJS `<Link ...>...<a ...` with just `<Link ...` **\
**Opening tags:**\
search: `<Link([^>]*?)>([^<]*?)<a`  \
replace: `<Link$1 $2`  \
**Closing tags:**\
search: `</ ?a>(*?)</ ?Link>`\
replace: `</Link>` .



&#x20;

&#x20;
