---
description: 'webdev, codequality, react, testing'
---

# Too many features, not enough testing

### My website exploded!

I built a beautiful website that searches the web and uses “natural language processing” to generate synonyms and phrases. It finds available domain names when the one you want is not available…

[![https://besta.domains](https://dev-to-uploads.s3.amazonaws.com/i/b65j5bwgrvwl86a3yji8.png)](https://besta.domains)

But, I realized it’s very difficult to run a business \(actually getting someone to pay money for it\). Ok, I’ll just continue this as a side project. So, I started applying for jobs, and doing interviews. Meanwhile, I was still tweaking and developing my app. One day, I go to use it online, and it is broken. Embarrassing! Wonder how many people saw it like this?!

[![besta.domains - broken](https://dev-to-uploads.s3.amazonaws.com/i/ivcneorbfh7vxunzwsz2.png)](https://besta.domains)

I was pushing changes without adequately testing them. Strange thing is I remember testing in production, clicking around, and it looking good. Maybe I forgot to clear cache.

The problem was a server-side-rendering issue. I’m using NextJS. Not their fault. I was trying to do something advanced and weird - serving two web apps from the same codebase, each serving a different homepage based on the domain name. I was spreading myself too thin, trying to publish stuff ASAP, using hacks and cutting corners. I'll write about this glitch in an upcoming post.

### How to make sure this never happens again?

* Slow down. Focus on quality, not quantity. Test test test.
* Set up automated integration/end-to-end testing. Unit tests are not enough! In this case, all the content and functionality was there, but because of a “server-side-rendering” bug, the HTML/CSS was broken sometimes. With “functional” \(or “end-to-end”\) testing, it’s possible to catch that. Still, you have to program the test to check for layout issues. It should be run by a separate server which runs on an interval and alerts you when there’s a problem. This will let you fix the issue as soon as one comes up, in case the site breaks sometime in the future.
* The testing needs to be part of the “continuous integration” process. It must pass before the code is allowed to go into production. This should be a required step in any production workflow, in any company, any team, no matter how big or small. This way, if there is an issue with new code, it can be caught before the code is deployed to production. Again, unit tests only check individual pieces. This needs to test the final product \(“functional”/”end-to-end” testing\).

### **ChecklyHQ to the rescue!**

[Checkly](https://checklyhq.com) is an amazing and FREE service which lets you test any website on an interval \(as often as every 5 minutes\), from multiple locations in the world. It has an interface for checking API data also, including response time.

It’s easy to make it part of the CI \(continuous integration\) or CD \(continuous delivery\)! You can program a quick Bash script into whatever build process you use, on the front or back end. But scroll down, theres more… ![ChecklyHQ CI/CD tab](https://dev-to-uploads.s3.amazonaws.com/i/gdm0yks755omxdcoi9z6.png)

It’s even easier when using Github with a pre-configured CI/CD hosting service like Vercel/Netlify/Heroku, or a custom configured Travis/Jenkins/etc. process which deploys a version of the website for each Git branch. With each new deployment, the temporary preview subdomain is passed to Github and then to Checkly via an environment variable.

**In the “SCRIPT” tab, write your Puppeteer script.** Mention `process.env.ENVIRONMENT_URL` to refer to this auto-generated subdomain: ![ChecklyHQ &quot;Script&quot; tab](https://dev-to-uploads.s3.amazonaws.com/i/7s8i12qdpunp5h5h0eya.png)

**In the “CI/CD” tab,** simply link the GitHub repo: ![ChecklyHQ connect to GitHub](https://dev-to-uploads.s3.amazonaws.com/i/zjtjrkiris9fb5gqfoom.png)

### Lessons to remember:

* A feature is not finished until it is tested - thoroughly, manually, and automatically, and this testing is part of a continuous integration process which will not let you deploy until all the checks pass.
* Don’t assume a program will function predictably. There are always unexpected things that will go wrong - sooner or later. Especially on the web, with multiple devices. There are so many edge cases! Even if it looks good to the developer, the end user may have a different experience. It’s important to automate tests for multiple devices and use cases.

### Related links:

[https://besta.domains](https://besta.domains) &lt;— the app

[https://paulshorey.com](https://paulshorey.com) &lt;— the author

[https://checklyhq.com](https://checklyhq.com) &lt;— awesome live functional testing for development/preview/staging/production

[https://www.browserstack.com](https://www.browserstack.com) &lt;— important \(also freemium\) tool to test your app in any browser or device

[https://jestjs.io/docs/en/getting-started](https://jestjs.io/docs/en/getting-started) &lt;— Jest unit-testing framework for React

[https://dev.to/toomuchdesign/dom-testing-next-js-applications-46ke](https://dev.to/toomuchdesign/dom-testing-next-js-applications-46ke) &lt;— great article about “integration” testing React apps

### Any advice, ideas, favorite tools or techniques?

Please please please comment below, or message me \([Paul Shorey](https://paulshorey.com)\). Thank you!

