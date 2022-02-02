export const ConfigParams: IConfigParams = {

    services: [
        {
            name: 'account-service',
            internetFacing: false,
            containerPort: 3000,
            healthCheckPath: '/health',
            memoryLimit: 512,
            cpuLimit: 256,
            desiredCount: 1,
            priority: 2,
            albPath:'/accounts*'

        },
        {
            name: 'customer-service',
            internetFacing: false,
            containerPort: 3000,
            healthCheckPath: '/health',
            memoryLimit: 512,
            cpuLimit: 256,
            desiredCount: 1,
            priority: 3,
            albPath:'/customers*'
        },
        {
            name: 'frontend-app',
            internetFacing: true,
            containerPort: 80,
            healthCheckPath: '/health',
            memoryLimit: 512,
            cpuLimit: 256,
            desiredCount: 1,
            priority: 4,
            albPath:'/*'
        }
    ]
}

export interface IConfigParams  {
    services: IService[]
}

export interface IService  {
    name: string;
    internetFacing: boolean;
    containerPort: number;
    healthCheckPath: string;
    memoryLimit: number,
    cpuLimit: number,
    desiredCount: number,
    priority: number,
    albPath: string
}