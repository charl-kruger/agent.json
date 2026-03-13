// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// https://astro.build/config
export default defineConfig({
	integrations: [
		starlight({
			title: 'agent.json',
			social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/charl-kruger/agent.json' }],
			sidebar: [
				{
					label: 'Getting Started',
					items: [
						{ label: 'Why agent.json', slug: 'guides/introduction' },
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
					label: 'Integrations',
					items: [
						{ label: 'Claude (Anthropic)', slug: 'integrations/claude' },
						{ label: 'OpenAI (GPTs & Assistants)', slug: 'integrations/openai' },
						{ label: 'LangChain / LangGraph', slug: 'integrations/langchain' },
						{ label: 'Vercel AI SDK', slug: 'integrations/vercel-ai' },
						{ label: 'Any HTTP client', slug: 'integrations/generic' },
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
