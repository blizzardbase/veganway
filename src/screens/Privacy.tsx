// Privacy, in plain words. Keep it honest: if the app changes what it stores, change this page in the same commit.
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { TopBar } from '../ui';

const SOURCE = 'https://github.com/blizzardbase/veganway';

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-lg font-extrabold">{title}</h2>
      {children}
    </section>
  );
}

function List({ items }: { items: string[] }) {
  return (
    <ul className="flex list-disc flex-col gap-1.5 pl-5 text-base">
      {items.map((x) => <li key={x}>{x}</li>)}
    </ul>
  );
}

export function Privacy() {
  return (
    <>
      <TopBar title="Privacy" back />
      <div className="flex flex-col gap-7 pb-8 text-base">
        <p>VeganWay DXB is run by members of the Dubai Vegan Community for its members. It is free and its code is open, so anyone can check what this page says.</p>

        <Block title="What we store">
          <List
            items={[
              'Your playful name, such as Saffron Chickpea.',
              'A one way fingerprint of your email. We can check it when you sign in, but nobody can turn it back into your email address.',
              'Your password, scrambled so that nobody can read it, not even us.',
              'Your recovery code, as a keyed fingerprint: a code made from it with a secret key only our server holds. We can check a code you type, but nobody can read your code back from it.',
              'For at most two days, a keyed fingerprint of your IP address, used only to slow down abuse such as password guessing. It cannot be turned back into your IP address.',
              'What you post and how you vote: places, products, services, recommendations, offers, discussions, polls, replies, upvotes and saved places.',
              'Anything you choose to add to your profile: a display name, a short bio and a photo. All optional.',
            ]}
          />
        </Block>

        <Block title="Signing up with an email that is taken">
          <p>If you sign up with an email that already has an account, the app says so. That means someone who knows your email could learn that you have an account here. A burner email is the most private choice.</p>
        </Block>

        <Block title="What we never store">
          <List
            items={[
              'Your email address itself.',
              'Your phone number. We never ask for it.',
              'Your location.',
              'Your IP address.',
              'Your device, browser or app details.',
            ]}
          />
          <p>We never send email, and we never ask for your real name.</p>
        </Block>

        <Block title="What our hosts see">
          <List
            items={[
              'Vercel runs the app. Like every web host, it briefly keeps request logs, which include your IP address. We cannot turn that off, and our code never saves it.',
              'Neon stores the database, in Frankfurt.',
              'Photos you add are public files on Vercel Blob. We remove location and camera details from every photo before it is saved.',
            ]}
          />
        </Block>

        <Block title="No tracking">
          <p>No analytics, no ads, no trackers, and no third party scripts, fonts or maps. The page talks only to its own server.</p>
        </Block>

        <Block title="Service contact details">
          <p>Members cannot post phone numbers or emails in their posts. Only the owner of a service can add a WhatsApp number, an Instagram handle or a website, and only on their own service page.</p>
        </Block>

        <Block title="Delete your account">
          <p>
            Go to <Link to="/me" className="-my-3 inline-flex min-h-11 min-w-11 items-center justify-center font-bold text-brand underline">Me</Link>, then Delete account. We remove your email fingerprint, your password, your recovery code, your profile and its photo, and every photo of yours that no post still shows. What you posted stays, shown as Former member, so conversations still make sense.
          </p>
        </Block>

        <Block title="Check the code">
          <p>
            The source code is public under the MIT licence:{' '}
            <a href={SOURCE} target="_blank" rel="noopener noreferrer nofollow ugc" className="inline-flex min-h-11 items-center font-bold break-all text-brand underline">{SOURCE}</a>
          </p>
        </Block>
      </div>
    </>
  );
}
