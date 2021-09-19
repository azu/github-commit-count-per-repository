import { graphql } from "@octokit/graphql";
import dayjs from "dayjs";
import * as fs from "fs";

type Repository = { owner: string; repo: string; defaultBranch: string };
type Repositories = Repository[];
export const fetchRepositories = async (
    options: { query: string; cursor?: string; GITHUB_TOKEN: string; since: string; until: string },
    results: Repositories = []
): Promise<Repositories> => {
    const graphqlWithAuth = graphql.defaults({
        headers: {
            authorization: `token ${options.GITHUB_TOKEN}`
        }
    });
    const QUERY = `query ($q: String!, $cursor: String) {
  search(query: $q, type: REPOSITORY, first: 100, after: $cursor) {
    pageInfo {
      endCursor
      hasNextPage
    }
    nodes {
      ... on Repository {
        owner {
          login
        }
        name
        defaultBranchRef {
           name
        }
        pushedAt
        isPrivate
      }
    }
  }
}
`;
    const { search } = await graphqlWithAuth<{
        search: {
            pageInfo: {
                endCursor: string | undefined;
                hasNextPage: boolean;
            };
            nodes: {
                name: string;
                owner: {
                    login: string;
                };
                defaultBranchRef: {
                    name: string;
                };
                pushedAt: string;
                isPrivate: boolean;
            }[];
        };
    }>(QUERY, { cursor: options.cursor, q: options.query + ` pushed:>=${options.since} ` });
    const nodes = search.nodes
        .filter((node) => {
            if (node.isPrivate) {
                return false;
            }
            return node?.defaultBranchRef?.name !== undefined;
        })
        .map((node) => {
            return {
                owner: node.owner.login,
                repo: node.name,
                defaultBranch: node.defaultBranchRef.name
            };
        });
    results.push(...nodes);
    if (search.pageInfo.hasNextPage) {
        await fetchRepositories({ ...options, cursor: search.pageInfo.endCursor }, results);
    }
    return results;
};

type RepositoriesCommits = (Repository & {
    totalCommitsCount: number;
})[];
export const fetchCommitCountOfRepository = async (options: {
    repositories: Repositories;
    since: string;
    until: string;
    GITHUB_TOKEN: string;
}): Promise<RepositoriesCommits> => {
    const fetchQuery = async (repositories: Repositories) => {
        const queryResults: RepositoriesCommits = [];
        const graphqlWithAuth = graphql.defaults({
            headers: {
                authorization: `token ${options.GITHUB_TOKEN}`
            }
        });
        const QUERY = `query {
  ${repositories
      .map((repository) => {
          const key = `${repository.owner}__${repository.repo}`.replace(/[.-]/g, "_");
          return `${key}: repository(owner: "${repository.owner}", name: "${repository.repo}") {
    object(expression: "${repository.defaultBranch}") {
      ... on Commit {
        history(since:"${options.since}" until:"${options.until}"){
          totalCount
        }
      }
    }
  }`;
      })
      .join("\n")}
}
`;
        const results = await graphqlWithAuth<{
            [index: string]: {
                object: {
                    history: {
                        totalCount: number;
                    };
                };
            };
        }>(QUERY);
        Object.entries(results).forEach(([key, value]) => {
            const match = options.repositories.find((repo) => {
                const repoKey = `${repo.owner}__${repo.repo}`.replace(/[.-]/g, "_");
                return key === repoKey;
            });
            if (match) {
                queryResults.push({
                    ...match,
                    totalCommitsCount: value.object.history.totalCount
                });
            }
        });
        return queryResults;
    };
    const limitQuery = 30;
    const allResults: RepositoriesCommits = [];
    for (let i = 0; i < options.repositories.length; i += limitQuery) {
        const results = await fetchQuery(options.repositories.slice(i, i + limitQuery));
        allResults.push(...results);
    }
    return allResults;
};

async function main() {
    const since = dayjs("2019-10-01", "YYYY-MM-DD").subtract(1, "y").toISOString();
    const until = dayjs("2020-10-01", "YYYY-MM-DD").subtract(1, "y").toISOString();
    const GITHUB_TOKEN = process.env.GITHUB_TOKEN!;
    console.log(`user:azu user:efcl pushed:>=${since} pushed:<=${until}`);
    const query = `user:azu user:efcl user:jser user:almin user:textlint user:textlint-ja user:textlint-rule user:JXA-userland user:js-primer user:ecmascript-daily user:asciidwango user:secretlint user:honkit`;
    const repositories = await fetchRepositories({
        GITHUB_TOKEN: GITHUB_TOKEN,
        query: query,
        since,
        until
    });
    const commits = await fetchCommitCountOfRepository({
        since,
        until,
        GITHUB_TOKEN,
        repositories
    });
    fs.writeFileSync(
        dayjs(since).format("YYYY") + ".json",
        JSON.stringify(
            commits
                .sort((a, b) => {
                    return b.totalCommitsCount - a.totalCommitsCount;
                })
                .map((item) => {
                    return {
                        ...item,
                        year: dayjs(since).format("YYYY")
                    };
                })
        ),
        "utf8"
    );
}

main();
