# Testing

Unit tests are useful. However, with complex applications, it takes an extreme amount of time to "mock" all the different data sources and integration. So, most of the time when people do "unit testing", they are actually doing "integration testing", which is the next step. This takes a lot of time and effort. Unfortunately, these tests still don't give you perfect confidence that the changes have not broken anything. Things that could break are: user interaction, edge cases, and often visual \(css\) layout issues. 

I prefer to do "end-to-end" \(also called "functional"\) tests. It's much easier to set up. You don't need to "mock" anything because you're actually testing the real end result which the user will see. It's much much less work to set up and write, without fake mocking or integrating anything. Everything is real. And, you get the benefit of testing the real finished app, as the user will see it. This type of testing takes a bit longer to execute, but not terribly long. I think it's a good compromise.

Doing functional testing, you can even set up "visual testing", to gain even more of the same benefits. This is even faster to set up and write, and it provides even greater certainty that nothing is broken.

Percy: [https://docs.percy.io/docs/percy-platform-basics](https://docs.percy.io/docs/percy-platform-basics)

Why: [https://blog.percy.io/why-visual-testing-is-more-than-catching-bugs-db0e817b84ed](https://blog.percy.io/why-visual-testing-is-more-than-catching-bugs-db0e817b84ed)

How to integrate with Jest/Puppeteer: [https://blog.percy.io/percy-for-puppeteer-automated-visual-testing-for-chrome-94143018ba79](https://blog.percy.io/percy-for-puppeteer-automated-visual-testing-for-chrome-94143018ba79)

Functional vs visual testing: [https://blog.percy.io/functional-testing-vs-visual-testing-differences-similarities-c246c31b1850?source=post\_recirc---------0----------------------------](https://blog.percy.io/functional-testing-vs-visual-testing-differences-similarities-c246c31b1850?source=post_recirc---------0----------------------------)

