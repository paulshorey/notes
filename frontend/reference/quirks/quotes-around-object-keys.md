# Quotes around object keys

#### Level: intermediate

Some keys must be WITHOUT quotes, because they're numbers. Other keys must be WITH quotes, because they contain special characters. 

Prettier disallows quotes around keys which are legal variable names \(simple alphabetic strings\). This is annoying. WebStorm formatting does not do this. It leaves it as I typed it. It's not breaking anything, not hurting anyone, so why should it be changed? Sometimes, having quotes around the key is better...

Below, for example, if search all domain extensions for "am", 40 results come up, and I have to scroll through each one, looking for the correct thing. It would be nice if I could search for "am" with surrounding quotes. Then I would get the one I'm looking for immediately. **Ofcourse, I could get used to searching for " am:", with leading space and trailing colon.**

The annoying thing is not this one rule, but the combination of many tiny annoyances. Prettier forces many small rules like this, with no way to override the setting, even if everyone on the team agrees. Prettier should be more human, not force everyone to do things the way that the group of Prettier developers think is right.

I missed the conversation about this on GitHub. [https://github.com/standard/standard/issues/791](https://github.com/standard/standard/issues/791). **This is just me venting about it.** Here's the lingo:[ https://eslint.org/docs/rules/quote-props](https://eslint.org/docs/rules/quote-props). Prettier uses "as-needed", which sounds nice, but is limiting, but should be "consistent-as-needed", which is liberal.

```text
  af: "1997-10-16",
  afamilycompany: "2016-07-14",
  afl: "2015-02-19",
  ...
  arab: "2017-05-11",
  aramco: "2015-08-20",
  archi: "2014-03-20",
  army: "2014-05-29",
  ...
  quebec: "2014-03-13",
  scot: "2014-06-05",
  yokohama: "2014-03-27",
  tirol: "2014-05-29",
  "radio.am": "1994-08-26",
  "radio.fm": "1995-04-19",
  ruhr: "2013-11-25",
  shiksha: "2014-01-16",
  gdn: "2014-12-04",
  ...
  allfinanz: "2014-09-25",
  allstate: "2016-02-05",
  ally: "2015-10-22",
  alsace: "2014-09-18",
  am: "1994-08-26",
  americanexpress: "2016-07-22",
  amex: "2016-07-21",
  amfam: "2016-07-14",
  amica: "2015-08-06",
  an: "1993-09-09",
  analytics: "2015-11-20",
  ...
  many more...
```

 



