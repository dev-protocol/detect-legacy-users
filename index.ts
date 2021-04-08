/* eslint-disable functional/no-expression-statement */
import { detect } from './src/detect'

const rpc = process.argv[2]
console.log({ rpc })

// eslint-disable-next-line functional/functional-parameters
detect(rpc)
	.then((results) => {
		results.map(([user, properties]) => {
			console.log(user, properties.size)
		})
	})
	.catch(console.error)
