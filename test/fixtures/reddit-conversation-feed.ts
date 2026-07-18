export const syntheticRedditConversationFeed = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <category term="singapore" label="r/singapore" />
  <entry>
    <author>
      <name>/u/synthetic-author</name>
      <uri>https://www.reddit.com/user/synthetic-author</uri>
    </author>
    <category term="singapore" label="r/singapore" />
    <content type="html">&lt;table&gt;&lt;tr&gt;&lt;td&gt;Ignored metadata&lt;/td&gt;&lt;td&gt;&lt;div class=&quot;md&quot;&gt;&lt;p&gt;Synthetic delay on the Circle Line.&lt;/p&gt;&lt;p&gt;Allow 10 extra minutes.&lt;/p&gt;&lt;/div&gt;&lt;a href=&quot;https://www.reddit.com/comments/synthetic1&quot;&gt;comments&lt;/a&gt;&lt;/td&gt;&lt;/tr&gt;&lt;/table&gt;</content>
    <id>t3_synthetic1</id>
    <link href="https://www.reddit.com/r/singapore/comments/synthetic1/fixture/" />
    <published>2026-07-18T00:00:00+00:00</published>
    <title>Synthetic rail condition</title>
    <updated>2026-07-18T00:00:00+00:00</updated>
  </entry>
  <entry>
    <author>
      <name>/u/synthetic-reply-author</name>
      <uri>https://www.reddit.com/user/synthetic-reply-author</uri>
    </author>
    <category term="singapore" label="r/singapore" />
    <content type="html">&lt;div class=&quot;md&quot;&gt;&lt;p&gt;Train is still held at one-north.&lt;/p&gt;&lt;/div&gt;</content>
    <id>t1_synthetic2</id>
    <link href="https://www.reddit.com/r/singapore/comments/synthetic1/fixture/synthetic2/" />
    <title>synthetic-reply-author on Synthetic rail condition</title>
    <updated>2026-07-18T00:05:00+00:00</updated>
  </entry>
  <entry>
    <category term="singapore" label="r/singapore" />
    <content type="html">&lt;div class=&quot;md&quot;&gt;&lt;p&gt;[removed]&lt;/p&gt;&lt;/div&gt;</content>
    <id>t1_synthetic3</id>
    <link href="https://www.reddit.com/r/singapore/comments/synthetic1/fixture/synthetic3/" />
    <title>removed reply title must be ignored</title>
    <updated>2026-07-18T00:06:00+00:00</updated>
  </entry>
</feed>`;

export function editSyntheticRootPost(
  feed: string,
  body: string,
  updatedAt = '2026-07-18T00:10:00+00:00',
): string {
  return feed
    .replace(
      'Synthetic delay on the Circle Line.&lt;/p&gt;&lt;p&gt;Allow 10 extra minutes.',
      body,
    )
    .replace(
      '<updated>2026-07-18T00:00:00+00:00</updated>',
      `<updated>${updatedAt}</updated>`,
    );
}
