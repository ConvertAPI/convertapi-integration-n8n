import type {
	IAuthenticateGeneric,
	Icon,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class ConvertApiApi implements ICredentialType {
	name = 'convertApiApi';

	displayName = 'ConvertAPI API';

	icon: Icon = {
		light: 'file:../icons/convertapi.svg',
		dark: 'file:../icons/convertapi.dark.svg',
	};

	documentationUrl = 'https://github.com/ConvertAPI/convertapi-integration-n8n?tab=readme-ov-file#credentials';

	properties: INodeProperties[] = [
		{
			displayName: 'API Token',
			name: 'apiToken',
			type: 'string',
			typeOptions: { password: true },
			required: true,
			default: '',
			description:
				'An API token from your ConvertAPI account at https://www.convertapi.com/a/authentication',
		},
		{
			displayName: 'Region',
			name: 'region',
			type: 'options',
			options: [
				{ name: 'Global (Nearest Data Center)', value: 'global' },
				{ name: 'Asia', value: 'as' },
				{ name: 'Australia', value: 'au' },
				{ name: 'Canada', value: 'ca' },
				{ name: 'European Union', value: 'eu' },
				{ name: 'Japan', value: 'jp' },
				{ name: 'United Kingdom', value: 'uk' },
				{ name: 'United States', value: 'us' },
			],
			default: 'global',
			description:
				'Where ConvertAPI processes your files. Pick a region to keep files in it; Global uses the nearest data center.',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiToken}}',
			},
		},
	};

	// A GET without a file costs no conversions: ConvertAPI answers 400 (code 4000) to a valid
	// token and 401 (code 4011) to a wrong one.
	test: ICredentialTestRequest = {
		request: {
			baseURL:
				'={{ $credentials.region && $credentials.region !== "global" ? "https://" + $credentials.region + "-v2.convertapi.com" : "https://v2.convertapi.com" }}',
			url: '/convert/docx/to/pdf',
			method: 'GET',
			ignoreHttpStatusErrors: true,
		},
		rules: [
			{
				type: 'responseSuccessBody',
				properties: {
					key: 'Code',
					value: 4011,
					message:
						'ConvertAPI did not accept the API token. Copy a token from https://www.convertapi.com/a/authentication.',
				},
			},
		],
	};
}
