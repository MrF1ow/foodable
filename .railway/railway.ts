// Railway infrastructure as code for the foodable service. Editing or pushing
// this file changes nothing on Railway: `railway config plan` previews the
// difference and `railway config apply` is what applies it. Variables are
// unmanaged, so secrets stay in Railway and are never read or written here.
import { defineRailway, github, project, service } from "railway/iac";

// This repository manages only its own resources in the environment. Other
// repositories export their own partial name.
// See https://docs.railway.com/infrastructure-as-code#multi-repo-projects
export const partial = "foodable";

export default defineRailway(() => {
    const foodable = service("foodable", {
        source: github("MrF1ow/foodable", {
            branch: "main",
            checkSuites: true,
        }),
        build: {
            buildEnvironment: "V3",
            builder: "DOCKERFILE",
            dockerfilePath: "Dockerfile",
        },
        healthcheck: "/health",
        healthcheckTimeout: 60,
        preDeploy: "bun run db:migrate",
        replicas: { "us-east4-eqdc4a": 1 },
        deploy: { restartPolicyType: "ON_FAILURE" },
        domains: [{ domain: "food.mrflow.dev", port: 8080 }],
    });

    return project("foodable", {
        // Read by the Railway CLI; the SDK's types do not declare it yet.
        // Without it the CLI refuses to plan while Railway holds variables
        // this file does not declare.
        // @ts-expect-error -- read by the Railway CLI; railway@3.16.0's types lack it
        variables: { managed: false },
        resources: [foodable],
    });
});
