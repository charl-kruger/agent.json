// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// https://astro.build/config
export default defineConfig({
	integrations: [
		starlight({
			title: 'agent-inbox',
			social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/charl-kruger/agentpop' }],
			sidebar: [
				{
					label: 'Getting Started',
					items: [
						{ label: 'Introduction', slug: 'guides/introduction' },
						{ label: 'Quick Start', slug: 'guides/quickstart' },
					],
				},
				{
					label: 'Protocol',
					items: [
						{ label: 'Discovery', slug: 'protocol/discovery' },
						{ label: 'Sending Messages', slug: 'protocol/sending-messages' },
						{ label: 'Responses', slug: 'protocol/responses' },
						{ label: 'Callbacks', slug: 'protocol/callbacks' },
					],
				},
				{
					label: 'Reference',
					autogenerate: { directory: 'reference' },
				},
			],
		}),
	],
});
