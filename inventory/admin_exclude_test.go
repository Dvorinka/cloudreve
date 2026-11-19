package inventory

import (
	"context"
	"testing"

	"github.com/cloudreve/Cloudreve/v4/ent"
	"github.com/cloudreve/Cloudreve/v4/ent/enttest"
	"github.com/cloudreve/Cloudreve/v4/inventory/types"
	"github.com/cloudreve/Cloudreve/v4/pkg/boolset"
	"github.com/cloudreve/Cloudreve/v4/pkg/conf"
	"github.com/cloudreve/Cloudreve/v4/pkg/hashid"
	"github.com/stretchr/testify/require"
)

func TestFlattenListFilesExcludesOwners(t *testing.T) {
	client := enttest.Open(t, "sqlite3", "file:"+t.Name()+"?mode=memory&cache=shared")
	t.Cleanup(func() { require.NoError(t, client.Close()) })
	ctx := context.Background()

	group := client.Group.Create().SetName("admins").SetPermissions(&boolset.BooleanSet{}).SaveX(ctx)
	ownerA := client.User.Create().SetEmail("a@example.com").SetNick("a").SetGroup(group).SaveX(ctx)
	ownerB := client.User.Create().SetEmail("b@example.com").SetNick("b").SetGroup(group).SaveX(ctx)
	rootA := client.File.Create().SetName(RootFolderName).SetType(int(types.FileTypeFolder)).SetOwner(ownerA).SaveX(ctx)
	rootB := client.File.Create().SetName(RootFolderName).SetType(int(types.FileTypeFolder)).SetOwner(ownerB).SaveX(ctx)
	client.File.Create().SetName("a-file").SetType(int(types.FileTypeFile)).SetOwner(ownerA).SetParent(rootA).SaveX(ctx)
	client.File.Create().SetName("b-file").SetType(int(types.FileTypeFile)).SetOwner(ownerB).SetParent(rootB).SaveX(ctx)

	hasher, err := hashid.New("exclude-test")
	require.NoError(t, err)
	files := NewFileClient(client, conf.SQLiteDB, hasher)

	excluded, err := files.FlattenListFiles(ctx, &FlattenListFileParameters{
		PaginationArgs: &PaginationArgs{Page: 0, PageSize: 50},
		ExcludeUserIDs: []int{ownerA.ID},
	})
	require.NoError(t, err)
	require.Equal(t, 1, excluded.PaginationResults.TotalItems)
	require.Len(t, excluded.Files, 1)
	require.Equal(t, ownerB.ID, excluded.Files[0].OwnerID)
	require.Equal(t, "b-file", excluded.Files[0].Name)

	all, err := files.FlattenListFiles(ctx, &FlattenListFileParameters{
		PaginationArgs: &PaginationArgs{Page: 0, PageSize: 50},
	})
	require.NoError(t, err)
	require.Equal(t, 2, all.PaginationResults.TotalItems)
}

func TestListActivityExcludesActors(t *testing.T) {
	client := enttest.Open(t, "sqlite3", "file:"+t.Name()+"?mode=memory&cache=shared")
	t.Cleanup(func() { require.NoError(t, client.Close()) })
	ctx := context.Background()

	activity := NewActivityClient(client, conf.SQLiteDB)
	_, err := activity.Record(ctx, &RecordActivityParams{Type: 1, ActorID: 7, IP: "1.1.1.1", Extra: map[string]any{}})
	require.NoError(t, err)
	_, err = activity.Record(ctx, &RecordActivityParams{Type: 1, ActorID: 8, IP: "1.1.1.1", Extra: map[string]any{}})
	require.NoError(t, err)

	events, total, err := activity.List(ctx, &ListActivityArgs{
		PaginationArgs:  PaginationArgs{Page: 0, PageSize: 50},
		ExcludeActorIDs: []int{7},
	})
	require.NoError(t, err)
	require.Equal(t, 1, total)
	require.Len(t, events, 1)
	require.Equal(t, 8, events[0].ActorID)
}

func TestSearchStaysInsideGivenParents(t *testing.T) {
	client := enttest.Open(t, "sqlite3", "file:"+t.Name()+"?mode=memory&cache=shared")
	t.Cleanup(func() { require.NoError(t, client.Close()) })
	ctx := context.Background()

	group := client.Group.Create().SetName("searchers").SetPermissions(&boolset.BooleanSet{}).SaveX(ctx)
	user := client.User.Create().SetEmail("s@example.com").SetNick("s").SetGroup(group).SaveX(ctx)
	root := client.File.Create().SetName(RootFolderName).SetType(int(types.FileTypeFolder)).SetOwner(user).SaveX(ctx)
	in := client.File.Create().SetName("in").SetType(int(types.FileTypeFolder)).SetOwner(user).SetParent(root).SaveX(ctx)
	also := client.File.Create().SetName("also").SetType(int(types.FileTypeFolder)).SetOwner(user).SetParent(root).SaveX(ctx)
	out := client.File.Create().SetName("out").SetType(int(types.FileTypeFolder)).SetOwner(user).SetParent(root).SaveX(ctx)
	client.File.Create().SetName("keep-in").SetType(int(types.FileTypeFile)).SetOwner(user).SetParent(in).SaveX(ctx)
	client.File.Create().SetName("keep-out").SetType(int(types.FileTypeFile)).SetOwner(user).SetParent(out).SaveX(ctx)

	hasher, err := hashid.New("search-scope")
	require.NoError(t, err)
	files := NewFileClient(client, conf.SQLiteDB, hasher)

	res, err := files.GetChildFiles(ctx, &ListFileParameters{
		PaginationArgs: &PaginationArgs{PageSize: 20},
		MixedType:      true,
		Search:         &SearchFileParameters{Name: []string{"keep"}},
	}, user.ID, in, also)
	require.NoError(t, err)
	require.Len(t, res.Files, 1)
	require.Equal(t, "keep-in", res.Files[0].Name)
}

func TestSearchManyParentsDoesNotDoubleBind(t *testing.T) {
	client := enttest.Open(t, "sqlite3", "file:"+t.Name()+"?mode=memory&cache=shared")
	t.Cleanup(func() { require.NoError(t, client.Close()) })

	hasher, err := hashid.New("search-parents")
	require.NoError(t, err)
	files := NewFileClient(client, conf.SQLiteDB, hasher)

	// SQLite allows 32766 parameters. Binding each parent twice fails
	// here; binding once does not. Upstream cloudreve/cloudreve#3625.
	const parentsN = 17000
	parents := make([]*ent.File, parentsN)
	for i := range parents {
		parents[i] = &ent.File{ID: i + 1}
	}

	_, err = files.GetChildFiles(context.Background(), &ListFileParameters{
		PaginationArgs: &PaginationArgs{PageSize: 10},
		MixedType:      true,
		Search:         &SearchFileParameters{Name: []string{"abc"}},
	}, 1, parents...)
	require.NoError(t, err)
}
