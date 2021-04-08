/* eslint-disable functional/no-expression-statement */
import { providers, Contract, BigNumber } from 'ethers'
import { aperture, flatten } from 'ramda'
import pQueue from 'p-queue'

const BIRTH = 9389482
const DEPOSIT_METHOD_ID = '0x47e7ef24'
const dev = (provider: providers.BaseProvider): Contract =>
	new Contract(
		'0x5cAf454Ba92e6F2c929DF14667Ee360eD9fD5b26',
		['event Transfer(address indexed from, address indexed to, uint256 value)'],
		provider
	)
const registry = (provider: providers.BaseProvider): Contract =>
	new Contract(
		'0x1d415aa39d647834786eb9b5a333a50e9935b796',
		['function lockup() external view returns (address)'],
		provider
	)
const factoryLockup = (provider: providers.BaseProvider) => (
	address: string
): Contract =>
	new Contract(
		address,
		[
			'function getStorageLastInterestPrice(address _property, address _user) public view returns (uint256)',
			'function getStorageInterestPrice(address _property) public view returns (uint256)',
		],
		provider
	)

// eslint-disable-next-line functional/functional-parameters, @typescript-eslint/explicit-module-boundary-types, @typescript-eslint/explicit-function-return-type
export const detect = async (providerEndpoint: string) => {
	const provider = new providers.JsonRpcProvider(providerEndpoint)
	const DEV = dev(provider)
	const REGISTRY = registry(provider)
	const transfer = DEV.filters.Transfer()
	const currentBlock = await provider.getBlockNumber()

	const blocks = aperture(
		2,
		((unit) =>
			new Array(Math.floor((currentBlock - BIRTH) / unit) + 1)
				.fill(null)
				.map((_, i) => BIRTH + i * unit))(10000)
	)

	console.log({ blocks })

	// Fetch all logs for Transfer
	const allTransferLogs = flatten(
		await new pQueue({ concurrency: 3 }).addAll(
			// eslint-disable-next-line functional/functional-parameters
			blocks.map(([from, _to]) => async () =>
				((to) =>
					DEV.queryFilter(transfer, from, to).then((evs) => {
						console.log(`${from} to ${to}:`, evs.length)
						return evs
					}))(_to - 1)
			)
		)
	)

	console.log('allTransferLogs length:', allTransferLogs.length)

	// Merge transaction data and transactionReceipt data into all logs
	const allTransferLogsWithTransaction = await Promise.all(
		allTransferLogs.map(async (log) => {
			const transaction = await log.getTransaction()
			return { ...log, transaction }
		})
	)

	// Filters by `deposit`
	const filteredByDeposit = allTransferLogsWithTransaction.filter((log) => {
		const { data } = log.transaction
		console.log({ data })
		return data.startsWith(DEPOSIT_METHOD_ID)
	})

	// Creates set for all sender
	const setByUser = new Set<string>(
		filteredByDeposit.map((log) => log.args?.from)
	)

	// Creates set for all properties
	const setByProperty = new Set<string>(
		filteredByDeposit.map((log) => log.args?.to)
	)

	// Cerates set for all sender and all staked properties
	const setByUserAndProperty = new Set<readonly [string, ReadonlySet<string>]>(
		Array.from(setByUser).map<readonly [string, ReadonlySet<string>]>(
			(user) => [
				user,
				new Set<string>(
					filteredByDeposit
						.filter((log) => log.args?.from === user)
						.map((log) => log.args?.to)
				),
			]
		)
	)

	// Creates Lockup Contract
	const LOCKUP = factoryLockup(provider)(await REGISTRY.lockup())

	const priceMap = new Map<string, BigNumber>()
	await Promise.all(
		Array.from(setByProperty).map(async (p) => {
			const price = await LOCKUP.getStorageInterestPrice(p)
			return priceMap.set(p, price)
		})
	)

	const results = await Promise.all(
		Array.from(setByUserAndProperty).map<
			Promise<readonly [string, ReadonlySet<string>]>
		>(async ([user, properties]) => {
			const lastPriceMap = new Map<string, BigNumber>()
			await Promise.all(
				Array.from(properties).map(async (p) => {
					const lastPrice = await LOCKUP.getStorageLastInterestPrice(user, p)
					return lastPriceMap.set(p, lastPrice)
				})
			)
			return [
				user,
				new Set(
					Array.from(properties).filter(
						(p) => priceMap.get(p) !== lastPriceMap.get(p)
					)
				),
			]
		})
	)
	return results
}
